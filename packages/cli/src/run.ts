import { join } from "node:path";
import {
  analyzeDependencies,
  artifactCatalog,
  type DependencyGraph,
  dependencyHtml,
  dependencyMermaid,
  dependencySvg,
  type EnvironmentEvidence,
  type EnvironmentProfile,
  type ErrorCode,
  exitCodeFor,
  findArtifactType,
  outputVersion,
  type PostgresProfile,
  parseConfig,
  parseManifest,
  parseMapping,
  parseModel,
  planSchema,
  type Result,
  readPlanHeader,
  record,
  redactText,
  SchemaError,
  selectEnvironment,
} from "@unverse/core";
import {
  applyPlan,
  apps,
  compareEnvironments,
  connectionReferences,
  connectors,
  type DataverseClient,
  DataverseError,
  type DependencyOptions,
  dependencyGraph,
  exportTransfer,
  flows,
  inspectSchema,
  listArtifacts,
  OrganizationMismatchError,
  type PlatformClient,
  planDataverseTransfer,
  planSeed,
  platformApps,
  platformFlows,
  query,
  resolveRole,
  solutionComponents,
  solutions,
  tables,
  type UserSelector,
  userRoles,
  users,
  variables,
  verifyPlan,
} from "@unverse/dataverse";
import type { PostgresStore } from "@unverse/postgres";
import { InputError, parseInvocation, requestsJson } from "./arguments.js";
import type { Format } from "./commands.js";
import { renderCsv } from "./csv.js";
import { specDocument } from "./help.js";
import {
  configFile,
  configTemplate,
  type ProjectRuntime,
  resolveConfigPath,
  resolveEnvironmentName,
} from "./project.js";

export interface CliRuntime extends ProjectRuntime {
  readonly readFile: (path: string) => Promise<string>;
  readonly writeFile: (path: string, content: string) => Promise<void>;
  readonly now: () => string;
  readonly writeOut: (line: string) => void;
  readonly writeError: (line: string) => void;
  readonly secrets: readonly string[];
  readonly connect?: (
    profile: EnvironmentProfile,
    name: string,
  ) => DataverseClient;
  readonly connectPlatform?: (
    profile: EnvironmentProfile,
    platformEnvironmentId: string,
  ) => PlatformClient;
  readonly connectPostgres?: (profile: PostgresProfile) => PostgresStore;
}

function unwrap(input: Record<string, unknown>): unknown {
  return input.outputVersion === outputVersion ? input.data : input;
}

async function readPlan(runtime: CliRuntime, path: string) {
  const document = unwrap(record(JSON.parse(await runtime.readFile(path))));
  return { document, ...readPlanHeader(document) };
}

async function readMapping(
  runtime: CliRuntime,
  flags: ReadonlyMap<string, string>,
) {
  return parseMapping(
    JSON.parse(await runtime.readFile(flags.get("--mapping-file") ?? "")),
  );
}

export async function runCli(
  argv: readonly string[],
  runtime: CliRuntime,
): Promise<number> {
  let command: string = "unknown";
  let environment: EnvironmentEvidence | undefined;
  let stage: "configuration" | "token and WhoAmI" = "configuration";
  let format: Format = requestsJson(argv) ? "json" : "human";
  const origins: string[] = [];
  const emit = (
    result: Result<unknown>,
    resultFormat: Format,
    output: CliRuntime,
  ) =>
    emitResult(
      { ...result, evidence: [...origins, ...result.evidence] },
      resultFormat,
      output,
    );
  try {
    const parsed = parseInvocation(argv);
    if (parsed.kind === "help") {
      if (parsed.requested) runtime.writeOut(parsed.text);
      else runtime.writeError(parsed.text);
      return parsed.requested ? 0 : 2;
    }
    const { flags, positionals } = parsed;
    command = parsed.route.path;
    format = parsed.format;
    if (command === "spec") {
      runtime.writeOut(
        `${JSON.stringify(specDocument(), null, format === "json" ? undefined : 2)}\n`,
      );
      return 0;
    }
    if (command === "artifact types")
      return emit(
        {
          outputVersion,
          command,
          timestamp: runtime.now(),
          status: "ok",
          data: { types: artifactCatalog },
          evidence: [
            "The built-in artifact catalog was read from this program.",
          ],
          coverage: {
            complete: true,
            limitations: ["No environment was contacted."],
          },
        },
        format,
        runtime,
      );
    if (command === "init") return await initialize(runtime, format);
    const needsEnvironment = parsed.route.command.flagsets.includes("target");
    const selected = needsEnvironment
      ? resolveEnvironmentName(flags, runtime)
      : undefined;
    const configPath = await resolveConfigPath(flags, runtime);
    origins.push(`Configuration ${configPath.value} ${configPath.origin}.`);
    if (selected !== undefined)
      origins.push(`Environment ${selected.value} from ${selected.origin}.`);
    const configuration = {
      path: configPath.value,
      origin: configPath.origin,
    };
    const config = parseConfig(
      JSON.parse(await runtime.readFile(configPath.value)),
    );
    if (command === "env list")
      return emit(
        {
          outputVersion,
          command,
          timestamp: runtime.now(),
          status: "ok",
          data: {
            configuration,
            environments: Object.entries(config.environments).map(
              ([name, { url }]) => ({ name, url }),
            ),
          },
          evidence: [
            "Configuration schema and every environment profile are valid.",
          ],
          coverage: {
            complete: true,
            limitations: [
              "Credential values and Dataverse reachability were not checked.",
            ],
          },
        },
        format,
        runtime,
      );
    const environmentName = selected?.value ?? "";
    const profile = selectEnvironment(config, environmentName);
    environment = { name: environmentName, url: profile.url };
    const base = {
      outputVersion,
      command,
      timestamp: runtime.now(),
      environment,
    } as const;
    if (command === "config check") {
      return emit(
        {
          ...base,
          status: "ok",
          data: { configVersion: config.configVersion, configuration },
          evidence: [
            "Configuration schema and selected environment profile are valid.",
          ],
          coverage: {
            complete: true,
            limitations: [
              "Credential values and Dataverse reachability were not checked.",
            ],
          },
        },
        format,
        runtime,
      );
    }
    if (command === "pg import" || command === "pg verify") {
      const input = record(
        JSON.parse(await runtime.readFile(flags.get("--manifest-file") ?? "")),
      );
      const manifest = await parseManifest(unwrap(input));
      if (
        manifest.source.environment.url !== profile.url ||
        manifest.source.environment.name !== environmentName
      )
        throw new InputError(
          "The manifest belongs to a different source environment profile.",
        );
      if (
        profile.postgres === undefined ||
        runtime.connectPostgres === undefined
      )
        throw new InputError(
          "The selected environment requires a postgres connection reference and dedicated schema.",
        );
      stage = "token and WhoAmI";
      const store = runtime.connectPostgres(profile.postgres);
      try {
        const report =
          command === "pg import"
            ? await store.import(manifest, true)
            : await store.verify(manifest);
        return emit(
          {
            ...base,
            status: report.verified ? "ok" : "failed",
            data: report,
            evidence: [
              "The immutable manifest and selected PostgreSQL schema were checked.",
            ],
            coverage: { complete: true, limitations: report.limitations },
          },
          format,
          runtime,
        );
      } finally {
        await store.close();
      }
    }
    const plan =
      command === "apply" || command === "verify"
        ? await readPlan(runtime, positionals.get("plan-file") ?? "")
        : undefined;
    if (
      command === "apply" &&
      plan?.effect === "destructive" &&
      !flags.has("--destructive")
    )
      throw new InputError(
        "The plan is destructive; apply it only with --destructive.",
      );
    if (
      (command === "app list" || command === "flow list") &&
      flags.get("--source") === "platform"
    ) {
      if (profile.platformEnvironmentId === undefined)
        throw new InputError(
          "--source platform requires platformEnvironmentId in the selected environment profile.",
        );
      if (command === "app list" && flags.has("--kind"))
        throw new InputError(
          "--kind is not offered by the Power Platform API; omit it with --source platform.",
        );
      if (runtime.connectPlatform === undefined)
        throw new DataverseError(
          "unsupported",
          "Power Platform API operations are unavailable in this runtime.",
        );
      stage = "token and WhoAmI";
      const platform = runtime.connectPlatform(
        profile,
        profile.platformEnvironmentId,
      );
      const search = flags.get("--search");
      return emit(
        {
          ...base,
          status: "ok",
          data:
            command === "app list"
              ? { apps: await platformApps(platform, search) }
              : { flows: await platformFlows(platform, search) },
          evidence: [
            `Paginated Power Platform API reads completed for platform environment ${profile.platformEnvironmentId}; the Dataverse organization was not contacted.`,
          ],
          coverage: {
            complete: true,
            limitations: [
              "Only resources the Power Platform API returns to this caller are listed; fields it does not provide are absent.",
              "Service principals need Power Platform admin registration and an RBAC role; flow APIs are supported for service principals only where no license is required.",
              "Whether flows that are not stored in Dataverse appear has not been verified; this source was implemented from the documentation.",
            ],
          },
        },
        format,
        runtime,
      );
    }
    stage = "token and WhoAmI";
    if (runtime.connect === undefined)
      throw new DataverseError(
        "unsupported",
        "Dataverse operations are unavailable in this runtime.",
      );
    const client = runtime.connect(profile, environmentName);
    const mapping =
      command === "schema inspect" ||
      command === "schema plan" ||
      command === "pg export"
        ? await readMapping(runtime, flags)
        : undefined;
    const model =
      command === "schema plan" || command === "pg export"
        ? parseModel(
            JSON.parse(await runtime.readFile(flags.get("--model-file") ?? "")),
          )
        : undefined;
    const identity = await client.whoAmI();
    if (command.startsWith("deps ")) {
      const numeric = (flag: string) =>
        flags.has(flag) ? { [flag]: Number(flags.get(flag)) } : {};
      const values = {
        ...numeric("--component-type"),
        ...numeric("--depth"),
        ...numeric("--max-nodes"),
        ...numeric("--max-edges"),
        ...numeric("--max-queries"),
      };
      const options: DependencyOptions = {
        ...(flags.has("--object-id")
          ? { objectId: flags.get("--object-id") ?? "" }
          : {}),
        ...(flags.has("--component-type")
          ? { componentType: values["--component-type"] as number }
          : {}),
        ...(flags.has("--reference-id")
          ? { referenceId: flags.get("--reference-id") ?? "" }
          : {}),
        ...(flags.has("--solution-id")
          ? { solutionId: flags.get("--solution-id") ?? "" }
          : {}),
        direction:
          command === "deps impact"
            ? "dependent"
            : ((flags.get("--direction") ??
                (command === "deps list" ? "required" : "both")) as
                | "required"
                | "dependent"
                | "both"),
        depth: command === "deps list" ? 1 : (values["--depth"] ?? 3),
        ...(values["--max-nodes"] === undefined
          ? {}
          : { maxNodes: values["--max-nodes"] }),
        ...(values["--max-edges"] === undefined
          ? {}
          : { maxEdges: values["--max-edges"] }),
        ...(values["--max-queries"] === undefined
          ? {}
          : { maxQueries: values["--max-queries"] }),
        bindings: !flags.has("--no-bindings"),
      };
      const graph = await dependencyGraph(client, options, {
        ...environment,
        organizationId: identity.organizationId,
      });
      const complete =
        command === "deps list" ? graph.complete : graph.closureComplete;
      return emit(
        {
          ...base,
          caller: { id: identity.applicationUserId, kind: "application-user" },
          status: complete ? "ok" : "inconclusive",
          data: { graph, analysis: analyzeDependencies(graph) },
          evidence: [
            "Official Dataverse dependency functions were traversed within the declared scope. Connection bindings are separate metadata evidence.",
          ],
          coverage: { complete, limitations: graph.limitations },
        },
        format,
        runtime,
      );
    }
    if (["connector list", "connref list", "connref show"].includes(command)) {
      const search = flags.get("--search");
      const solutionId = flags.get("--solution-id");
      const id = positionals.get("reference-id");
      const options = {
        ...(search === undefined ? {} : { search }),
        ...(solutionId === undefined ? {} : { solutionId }),
        ...(id === undefined ? {} : { id }),
      };
      const rows =
        command === "connector list"
          ? await connectors(client, options)
          : await connectionReferences(client, options);
      if (command === "connref show" && rows.length !== 1)
        throw new InputError(
          "The connection reference was not found uniquely in the selected environment.",
        );
      return emit(
        {
          ...base,
          caller: { id: identity.applicationUserId, kind: "application-user" },
          status: "ok",
          data: { resources: rows },
          evidence: [
            "Whitelisted connector and connection reference metadata was read.",
          ],
          coverage: {
            complete: true,
            limitations: [
              "Only visible solution-aware metadata is listed. Connections, credentials, health, permissions, DLP, and observed consumers are not tested by this inventory.",
            ],
          },
        },
        format,
        runtime,
      );
    }
    if (command === "artifact list") {
      const spec = findArtifactType(positionals.get("type") ?? "");
      if (spec === undefined)
        throw new InputError("The artifact type is not in the catalog.");
      const limit = flags.get("--limit");
      const { items, complete } = await listArtifacts(
        client,
        spec,
        limit === undefined ? undefined : Number(limit),
      );
      return emit(
        {
          ...base,
          caller: { id: identity.applicationUserId, kind: "application-user" },
          status: complete ? "ok" : "inconclusive",
          data: { type: spec.type, items },
          evidence: [
            "Selected environment identity and paginated inventory reads completed.",
          ],
          coverage: {
            complete,
            limitations: [
              "Only items visible to this caller are listed, and only the fields the catalog declares for the type.",
              ...(complete
                ? []
                : [
                    "The item cap stopped the list before all items were returned.",
                  ]),
            ],
          },
        },
        format,
        runtime,
      );
    }
    if (plan !== undefined) {
      const context = {
        ...environment,
        organizationId: identity.organizationId,
      };
      const outcome =
        command === "apply"
          ? await applyPlan(client, plan.document, context, true)
          : await verifyPlan(client, plan.document, context);
      return emit(
        {
          ...base,
          caller: { id: identity.applicationUserId, kind: "application-user" },
          status: outcome.status,
          data: outcome.report,
          evidence: [
            "The reviewed plan was bound to the selected environment and the target was re-inspected.",
          ],
          coverage: {
            complete: outcome.status === "ok",
            limitations: (record(outcome.report).limitations ??
              []) as readonly string[],
          },
        },
        format,
        runtime,
      );
    }
    if (["seed plan", "transfer plan"].includes(command)) {
      const context = {
        ...environment,
        organizationId: identity.organizationId,
      };
      let data: unknown;
      if (command === "seed plan")
        data = await planSeed(
          client,
          JSON.parse(await runtime.readFile(flags.get("--seed-file") ?? "")),
          context,
        );
      else {
        const input = record(
          JSON.parse(
            await runtime.readFile(flags.get("--manifest-file") ?? ""),
          ),
        );
        data = await planDataverseTransfer(
          client,
          unwrap(input),
          JSON.parse(await runtime.readFile(flags.get("--policy-file") ?? "")),
          await readMapping(runtime, flags),
          context,
        );
      }
      const report = record(data);
      return emit(
        {
          ...base,
          caller: { id: identity.applicationUserId, kind: "application-user" },
          status: "ok",
          data,
          evidence: [
            "The target schema and data state were read to plan create-only operations.",
          ],
          coverage: {
            complete: true,
            limitations: (report.limitations ?? []) as readonly string[],
          },
        },
        format,
        runtime,
      );
    }
    if (
      [
        "solution list",
        "solution show",
        "app list",
        "flow list",
        "user list",
        "variable list",
        "env compare",
      ].includes(command)
    ) {
      const search = flags.get("--search");
      let data: unknown;
      let status: "ok" | "failed" | "inconclusive" = "ok";
      let limitations = [
        "Only resources visible to this caller are listed; app contents, flow definitions, secret values, and effective access are not inspected.",
      ];
      if (command === "env compare") {
        const targetName = flags.get("--target-env") ?? "";
        const targetProfile = selectEnvironment(config, targetName);
        if (targetProfile.url === profile.url)
          throw new InputError(
            "Comparison requires distinct environment URLs.",
          );
        const target = runtime.connect(targetProfile, targetName);
        const targetIdentity = await target.whoAmI();
        const comparison = await compareEnvironments(
          client,
          target,
          flags.get("--scope") as
            | "all"
            | "solutions"
            | "variables"
            | "components"
            | undefined,
          flags.get("--component-solution"),
        );
        data = {
          ...comparison,
          target: {
            name: targetName,
            url: targetProfile.url,
            organizationId: targetIdentity.organizationId,
            callerId: targetIdentity.applicationUserId,
          },
        };
        status = comparison.unknown.length
          ? "inconclusive"
          : comparison.equal
            ? "ok"
            : "failed";
        limitations = [...comparison.limitations];
      } else if (command === "solution list")
        data = { solutions: await solutions(client, search) };
      else if (command === "solution show")
        data = {
          components: await solutionComponents(
            client,
            positionals.get("solution-id") ?? "",
          ),
        };
      else if (command === "app list")
        data = {
          apps: await apps(
            client,
            flags.get("--kind") as
              | "all"
              | "canvas"
              | "model-driven"
              | undefined,
            search,
          ),
        };
      else if (command === "flow list")
        data = { flows: await flows(client, search) };
      else if (command === "user list")
        data = { users: await users(client, search) };
      else data = { variables: await variables(client, search) };
      return emit(
        {
          ...base,
          caller: { id: identity.applicationUserId, kind: "application-user" },
          status,
          data,
          evidence: [
            "Selected environment identity and paginated inventory reads completed.",
          ],
          coverage: { complete: status !== "inconclusive", limitations },
        },
        format,
        runtime,
      );
    }
    if (
      command === "pg export" &&
      model !== undefined &&
      mapping !== undefined
    ) {
      const manifest = await exportTransfer(client, model, mapping, {
        ...environment,
        organizationId: identity.organizationId,
      });
      return emit(
        {
          ...base,
          caller: { id: identity.applicationUserId, kind: "application-user" },
          status: "ok",
          data: manifest,
          evidence: [
            "Compatible modeled records were read, normalized, and fingerprinted.",
          ],
          coverage: {
            complete: true,
            limitations: [
              "The export is not a cross-page transactional snapshot and does not include workflows or access policies.",
            ],
          },
        },
        format,
        runtime,
      );
    }
    if (command.startsWith("schema ")) {
      const schemaEnvironment = {
        ...environment,
        organizationId: identity.organizationId,
      };
      const data =
        mapping !== undefined && model !== undefined
          ? await planSchema(
              model,
              mapping,
              schemaEnvironment,
              await inspectSchema(client, mapping, model),
            )
          : mapping !== undefined
            ? await inspectSchema(client, mapping)
            : undefined;
      return emit(
        {
          ...base,
          caller: { id: identity.applicationUserId, kind: "application-user" },
          status: "ok",
          data,
          evidence: [
            "Metadata inspected in the selected environment; apply rechecks the reviewed state before writing.",
          ],
          coverage: {
            complete: true,
            limitations: [
              "Only additive changes are supported. Dataverse required fields are application-level, not a server-side NOT NULL guarantee.",
            ],
          },
        },
        format,
        runtime,
      );
    }
    if (command === "table list" || command === "record query") {
      let data: unknown;
      let complete = true;
      if (command === "table list")
        data = { tables: await tables(client, flags.get("--search")) };
      else {
        const filterPath = flags.get("--filter-file");
        const filter =
          filterPath === undefined
            ? undefined
            : await runtime.readFile(filterPath);
        const orderBy = flags.get("--order-by");
        const rawLimit = flags.get("--limit");
        const result = await query(client, {
          table: positionals.get("table") ?? "",
          select: (flags.get("--select") ?? "")
            .split(",")
            .map((column) => column.trim()),
          ...(filter === undefined ? {} : { filter }),
          ...(orderBy === undefined ? {} : { orderBy }),
          ...(rawLimit === undefined ? {} : { limit: Number(rawLimit) }),
        });
        data = { rows: result.rows };
        complete = result.complete;
      }
      return emit(
        {
          ...base,
          caller: { id: identity.applicationUserId, kind: "application-user" },
          status: complete ? "ok" : "inconclusive",
          data,
          evidence: [
            "Metadata resolved from the selected environment; returned pages were read.",
          ],
          coverage: {
            complete,
            limitations: complete
              ? []
              : [
                  "The requested row cap stopped collection before all matching rows were read.",
                ],
          },
        },
        format,
        runtime,
      );
    }
    if (command === "user show" || command === "role check") {
      const roleId =
        command === "role check"
          ? await resolveRole(client, {
              ...(flags.has("--role-id")
                ? { id: flags.get("--role-id") ?? "" }
                : { name: flags.get("--role") ?? "" }),
            })
          : undefined;
      const assignments = await userRoles(
        client,
        userSelector(flags, identity.applicationUserId),
      );
      const assigned =
        roleId === undefined
          ? undefined
          : assignments.roles.some((role) => role.id === roleId);
      return emit(
        {
          ...base,
          caller: { id: identity.applicationUserId, kind: "application-user" },
          subject: {
            id: assignments.user.id,
            name: assignments.user.name,
            kind: "user",
          },
          status: assigned === false ? "failed" : "ok",
          data: {
            ...assignments,
            ...(roleId === undefined
              ? {}
              : { expectedRoleId: roleId, assigned }),
          },
          evidence: [
            "Direct roles and roles from all retrieved teams were collected.",
          ],
          coverage: {
            complete: true,
            limitations: [
              "Retrieved team memberships do not prove transitive group membership or effective table, column, or record access.",
            ],
          },
        },
        format,
        runtime,
      );
    }
    return emit(
      {
        ...base,
        caller: { id: identity.applicationUserId, kind: "application-user" },
        status: "ok",
        data:
          command === "env doctor"
            ? {
                checks: [
                  { name: "configuration", status: "ok" },
                  { name: "token", status: "ok" },
                  { name: "WhoAmI", status: "ok" },
                ],
                identity,
              }
            : identity,
        evidence: [
          "Dataverse WhoAmI completed.",
          ...(profile.expectedOrganizationId === undefined
            ? []
            : [
                `Organization ${identity.organizationId} matches expectedOrganizationId ${profile.expectedOrganizationId}.`,
              ]),
        ],
        coverage: {
          complete: true,
          limitations: [
            "Only WhoAmI was probed; table, role, and record access were not checked.",
          ],
        },
      },
      format,
      runtime,
    );
  } catch (error) {
    const code: ErrorCode =
      error instanceof DataverseError
        ? error.code
        : error instanceof SchemaError
          ? error.code
          : stage === "configuration" ||
              error instanceof InputError ||
              error instanceof SyntaxError
            ? "invalid-input"
            : "service";
    const message = error instanceof Error ? error.message : "Command failed.";
    return emit(
      {
        outputVersion,
        command,
        timestamp: runtime.now(),
        ...(environment === undefined ? {} : { environment }),
        status: "error",
        ...(command === "env doctor"
          ? {
              data: {
                checks: [
                  {
                    name: "configuration",
                    status: stage === "configuration" ? "error" : "ok",
                  },
                  {
                    name: "token",
                    status:
                      stage === "configuration"
                        ? "not-run"
                        : error instanceof OrganizationMismatchError
                          ? "ok"
                          : code === "authentication"
                            ? "error"
                            : code === "invalid-input"
                              ? "not-run"
                              : "unknown",
                  },
                  {
                    name: "WhoAmI",
                    status:
                      error instanceof OrganizationMismatchError
                        ? "error"
                        : stage === "configuration" ||
                            code === "authentication" ||
                            code === "invalid-input"
                          ? "not-run"
                          : "error",
                  },
                ],
              },
            }
          : {}),
        evidence: [],
        coverage: {
          complete: false,
          limitations: ["The investigation did not complete."],
        },
        error: { code, message },
      },
      format,
      runtime,
    );
  }
}

const userFlagFields = [
  ["--user-id", "id"],
  ["--email", "email"],
  ["--domain", "domain"],
  ["--name", "name"],
] as const;

function userSelector(
  flags: ReadonlyMap<string, string>,
  callerId: string,
): UserSelector {
  if (flags.has("--caller")) return { field: "id", value: callerId };
  const [flag, field] =
    userFlagFields.find(([name]) => flags.has(name)) ?? userFlagFields[0];
  return { field, value: flags.get(flag) ?? "" };
}

function render(result: Result<unknown>, format: Format): string {
  switch (format) {
    case "json":
      return `${JSON.stringify(result)}\n`;
    case "human":
      return `${JSON.stringify(result, null, 2)}\n`;
    case "csv":
      return renderCsv(result);
    default: {
      const graph = record(result.data).graph as DependencyGraph;
      if (format === "html") return dependencyHtml(graph);
      return format === "svg" ? dependencySvg(graph) : dependencyMermaid(graph);
    }
  }
}

async function initialize(
  runtime: CliRuntime,
  format: Format,
): Promise<number> {
  const path = join(runtime.cwd, configFile);
  const exists = await runtime.fileExists(path);
  if (exists && (await runtime.readFile(path)) !== configTemplate)
    throw new InputError(
      `${path} already exists and differs from the template; init does not overwrite it.`,
    );
  if (!exists) await runtime.writeFile(path, configTemplate);
  return emitResult(
    {
      outputVersion,
      command: "init",
      timestamp: runtime.now(),
      status: "ok",
      data: { path, created: !exists },
      evidence: [
        exists
          ? `${path} already holds the template.`
          : `${path} was created from the template.`,
      ],
      coverage: {
        complete: true,
        limitations: [
          "The template holds placeholder values; credential values and Dataverse reachability were not checked.",
        ],
      },
    },
    format,
    runtime,
  );
}

function emitResult(
  result: Result<unknown>,
  format: Format,
  runtime: CliRuntime,
): number {
  if (format !== "json" && result.status === "error")
    runtime.writeError(
      `${redactText(result.error?.message ?? "Command failed.", runtime.secrets)}\n`,
    );
  else runtime.writeOut(redactText(render(result, format), runtime.secrets));
  return exitCodeFor(result);
}
