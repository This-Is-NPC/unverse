import {
  analyzeDependencies,
  type DependencyGraph,
  dependencyHtml,
  dependencyMermaid,
  dependencySvg,
  type EnvironmentEvidence,
  type EnvironmentProfile,
  type ErrorCode,
  exitCodeFor,
  outputVersion,
  type PostgresProfile,
  parseConfig,
  parseManifest,
  parseMapping,
  parseModel,
  planSchema,
  type Result,
  record,
  redactText,
  SchemaError,
  selectEnvironment,
} from "@unverse/core";
import {
  applyDataPlan,
  applySchema,
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
  planDataverseTransfer,
  planSeed,
  query,
  resolveRole,
  solutionComponents,
  solutions,
  tables,
  type UserSelector,
  userRoles,
  users,
  variables,
} from "@unverse/dataverse";
import type { PostgresStore } from "@unverse/postgres";
import {
  type CommandName,
  commandDefinitions,
  commandOptions,
  optionDefinitions,
  optionRequired,
  renderHelp,
} from "./commands.js";
import { renderCsv } from "./csv.js";

export interface CliRuntime {
  readonly readFile: (path: string) => Promise<string>;
  readonly now: () => string;
  readonly writeOut: (line: string) => void;
  readonly writeError: (line: string) => void;
  readonly secrets: readonly string[];
  readonly connect?: (profile: EnvironmentProfile) => DataverseClient;
  readonly connectPostgres?: (profile: PostgresProfile) => PostgresStore;
}

interface ParsedArguments {
  readonly command: CommandName;
  readonly configPath: string;
  readonly environmentName: string;
  readonly options: ReadonlyMap<string, string>;
}

class InputError extends Error {}

export async function runCli(
  argv: readonly string[],
  runtime: CliRuntime,
): Promise<number> {
  const json = argv.includes("--json");
  if (argv.length === 0 || argv.includes("--help")) {
    runtime.writeOut(renderHelp());
    return 0;
  }
  let command: string = "unknown";
  let environment: EnvironmentEvidence | undefined;
  let stage: "configuration" | "token and WhoAmI" = "configuration";
  try {
    const formats = ["--json", "--csv", "--html", "--mermaid", "--svg"].filter(
      (flag) => argv.includes(flag),
    );
    if (formats.length > 1)
      throw new InputError(
        "Choose one output format: --json, --csv, --html, --mermaid, or --svg.",
      );
    if (formats.length && formats[0] !== "--json") {
      const original = runtime;
      runtime = {
        ...original,
        writeOut: (line) => {
          const result = JSON.parse(line) as Result<unknown>;
          if (result.status === "error") original.writeError(line);
          else if (argv.includes("--csv")) original.writeOut(renderCsv(result));
          else {
            const graph = record(result.data).graph as DependencyGraph;
            original.writeOut(
              argv.includes("--html")
                ? dependencyHtml(graph)
                : argv.includes("--svg")
                  ? dependencySvg(graph)
                  : dependencyMermaid(graph),
            );
          }
        },
      };
    }
    const parsed = parseArguments(argv);
    command = parsed.command;
    const config = parseConfig(
      JSON.parse(await runtime.readFile(parsed.configPath)),
    );
    const profile = selectEnvironment(config, parsed.environmentName);
    environment = { name: parsed.environmentName, url: profile.url };
    const base = {
      outputVersion,
      command,
      timestamp: runtime.now(),
      environment,
    } as const;
    if (parsed.command === "config validate") {
      return emit(
        {
          ...base,
          status: "ok",
          data: { configVersion: config.configVersion },
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
        json,
        runtime,
      );
    }
    if (
      parsed.command === "transfer import" ||
      parsed.command === "transfer verify"
    ) {
      if (
        parsed.command === "transfer import" &&
        !parsed.options.has("--confirm")
      )
        throw new InputError("Transfer import requires explicit --confirm.");
      const input = record(
        JSON.parse(
          await runtime.readFile(parsed.options.get("--manifest-file") ?? ""),
        ),
      );
      const manifest = await parseManifest(
        input.outputVersion === outputVersion ? input.data : input,
      );
      if (
        manifest.source.environment.url !== profile.url ||
        manifest.source.environment.name !== parsed.environmentName
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
          parsed.command === "transfer import"
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
          json,
          runtime,
        );
      } finally {
        await store.close();
      }
    }
    stage = "token and WhoAmI";
    const selector =
      parsed.command === "user roles" || parsed.command === "check role"
        ? userSelector(parsed.options)
        : undefined;
    if (
      parsed.command === "check role" &&
      Number(parsed.options.has("--role-id")) +
        Number(parsed.options.has("--role")) !==
        1
    )
      throw new InputError("Select exactly one of --role-id or --role.");
    if (runtime.connect === undefined)
      throw new DataverseError(
        "unsupported",
        "Dataverse operations are unavailable in this runtime.",
      );
    const client = runtime.connect(profile);
    if (
      ["seed apply", "transfer apply"].includes(parsed.command) &&
      !parsed.options.has("--confirm")
    )
      throw new InputError("Data apply requires explicit --confirm.");
    const mapping =
      parsed.command === "schema inspect" ||
      parsed.command === "schema plan" ||
      parsed.command === "transfer export"
        ? parseMapping({
            prefix: parsed.options.get("--prefix"),
            solution: parsed.options.get("--solution"),
          })
        : undefined;
    const model =
      parsed.command === "schema plan" || parsed.command === "transfer export"
        ? parseModel(
            JSON.parse(
              await runtime.readFile(parsed.options.get("--model-file") ?? ""),
            ),
          )
        : undefined;
    const inputPlan =
      parsed.command === "schema apply"
        ? record(
            JSON.parse(
              await runtime.readFile(parsed.options.get("--plan-file") ?? ""),
            ),
          )
        : undefined;
    if (inputPlan !== undefined && !parsed.options.has("--confirm"))
      throw new InputError("schema apply requires explicit --confirm.");
    const identity = await client.whoAmI();
    if (parsed.command.startsWith("dependencies ")) {
      const numeric = (flag: string) =>
        parsed.options.has(flag)
          ? { [flag]: Number(parsed.options.get(flag)) }
          : {};
      const values = {
        ...numeric("--component-type"),
        ...numeric("--depth"),
        ...numeric("--max-nodes"),
        ...numeric("--max-edges"),
        ...numeric("--max-queries"),
      };
      const options: DependencyOptions = {
        ...(parsed.options.has("--object-id")
          ? { objectId: parsed.options.get("--object-id") ?? "" }
          : {}),
        ...(parsed.options.has("--component-type")
          ? { componentType: values["--component-type"] as number }
          : {}),
        ...(parsed.options.has("--reference-id")
          ? { referenceId: parsed.options.get("--reference-id") ?? "" }
          : {}),
        ...(parsed.options.has("--solution-id")
          ? { solutionId: parsed.options.get("--solution-id") ?? "" }
          : {}),
        direction:
          parsed.command === "dependencies impact"
            ? "dependent"
            : ((parsed.options.get("--direction") ??
                (parsed.command === "dependencies list"
                  ? "required"
                  : "both")) as "required" | "dependent" | "both"),
        depth:
          parsed.command === "dependencies list" ? 1 : (values["--depth"] ?? 3),
        ...(values["--max-nodes"] === undefined
          ? {}
          : { maxNodes: values["--max-nodes"] }),
        ...(values["--max-edges"] === undefined
          ? {}
          : { maxEdges: values["--max-edges"] }),
        ...(values["--max-queries"] === undefined
          ? {}
          : { maxQueries: values["--max-queries"] }),
        bindings: !parsed.options.has("--no-bindings"),
      };
      const graph = await dependencyGraph(client, options, {
        ...environment,
        organizationId: identity.organizationId,
      });
      const complete =
        parsed.command === "dependencies list"
          ? graph.complete
          : graph.closureComplete;
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
        json,
        runtime,
      );
    }
    if (
      [
        "connectors list",
        "connection-references list",
        "connection-references inspect",
      ].includes(parsed.command)
    ) {
      const search = parsed.options.get("--search");
      const solutionId = parsed.options.get("--solution-id");
      const id = parsed.options.get("--reference-id");
      const options = {
        ...(search === undefined ? {} : { search }),
        ...(solutionId === undefined ? {} : { solutionId }),
        ...(id === undefined ? {} : { id }),
      };
      const rows =
        parsed.command === "connectors list"
          ? await connectors(client, options)
          : await connectionReferences(client, options);
      if (
        parsed.command === "connection-references inspect" &&
        rows.length !== 1
      )
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
        json,
        runtime,
      );
    }
    if (
      ["seed plan", "seed apply", "transfer plan", "transfer apply"].includes(
        parsed.command,
      )
    ) {
      const context = {
        ...environment,
        organizationId: identity.organizationId,
      };
      let data: unknown;
      if (parsed.command === "seed plan")
        data = await planSeed(
          client,
          JSON.parse(
            await runtime.readFile(parsed.options.get("--seed-file") ?? ""),
          ),
          context,
        );
      else if (parsed.command === "transfer plan") {
        const input = record(
          JSON.parse(
            await runtime.readFile(parsed.options.get("--manifest-file") ?? ""),
          ),
        );
        data = await planDataverseTransfer(
          client,
          input.outputVersion === outputVersion ? input.data : input,
          JSON.parse(
            await runtime.readFile(parsed.options.get("--policy-file") ?? ""),
          ),
          parseMapping({
            prefix: parsed.options.get("--prefix"),
            solution: parsed.options.get("--solution"),
          }),
          context,
        );
      } else {
        const input = record(
          JSON.parse(
            await runtime.readFile(parsed.options.get("--plan-file") ?? ""),
          ),
        );
        const plan = record(
          input.outputVersion === outputVersion ? input.data : input,
        );
        if (
          plan.purpose !==
          (parsed.command === "seed apply" ? "seed" : "transfer")
        )
          throw new InputError(
            "The plan purpose does not match the apply command.",
          );
        data = await applyDataPlan(
          client,
          plan,
          context,
          parsed.options.has("--confirm"),
        );
      }
      const report = record(data);
      return emit(
        {
          ...base,
          caller: { id: identity.applicationUserId, kind: "application-user" },
          status: report.verified === false ? "failed" : "ok",
          data,
          evidence: [
            "The target schema, data state, and explicit write guards were checked.",
          ],
          coverage: {
            complete: true,
            limitations: (report.limitations ?? []) as readonly string[],
          },
        },
        json,
        runtime,
      );
    }
    if (
      [
        "solutions list",
        "solution components",
        "apps list",
        "flows list",
        "users list",
        "variables list",
        "environment compare",
      ].includes(parsed.command)
    ) {
      const search = parsed.options.get("--search");
      let data: unknown;
      let status: "ok" | "failed" | "inconclusive" = "ok";
      let limitations = [
        "Only resources visible to this caller are listed; app contents, flow definitions, secret values, and effective access are not inspected.",
      ];
      if (parsed.command === "environment compare") {
        const targetName = parsed.options.get("--target-env") ?? "";
        const targetProfile = selectEnvironment(config, targetName);
        if (targetProfile.url === profile.url)
          throw new InputError(
            "Comparison requires distinct environment URLs.",
          );
        const target = runtime.connect(targetProfile);
        const targetIdentity = await target.whoAmI();
        const comparison = await compareEnvironments(
          client,
          target,
          parsed.options.get("--scope") as
            | "all"
            | "solutions"
            | "variables"
            | "components"
            | undefined,
          parsed.options.get("--component-solution"),
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
      } else if (parsed.command === "solutions list")
        data = { solutions: await solutions(client, search) };
      else if (parsed.command === "solution components")
        data = {
          components: await solutionComponents(
            client,
            parsed.options.get("--solution-id") ?? "",
          ),
        };
      else if (parsed.command === "apps list")
        data = {
          apps: await apps(
            client,
            parsed.options.get("--kind") as
              | "all"
              | "canvas"
              | "model-driven"
              | undefined,
            search,
          ),
        };
      else if (parsed.command === "flows list")
        data = { flows: await flows(client, search) };
      else if (parsed.command === "users list")
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
        json || argv.includes("--csv"),
        runtime,
      );
    }
    if (
      parsed.command === "transfer export" &&
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
        json,
        runtime,
      );
    }
    if (parsed.command.startsWith("schema ")) {
      const schemaEnvironment = {
        ...environment,
        organizationId: identity.organizationId,
      };
      const data =
        inputPlan !== undefined
          ? await applySchema(
              client,
              inputPlan.data ?? inputPlan,
              schemaEnvironment,
              parsed.options.has("--confirm"),
            )
          : mapping !== undefined && model !== undefined
            ? await planSchema(
                model,
                mapping,
                schemaEnvironment,
                await inspectSchema(client, mapping, model),
              )
            : mapping !== undefined
              ? await inspectSchema(client, mapping)
              : undefined;
      const unfinished =
        parsed.command === "schema apply" &&
        ((record(data).operations as readonly unknown[]).length !== 0 ||
          (record(data).blocked as readonly unknown[]).length !== 0);
      return emit(
        {
          ...base,
          caller: { id: identity.applicationUserId, kind: "application-user" },
          status: unfinished ? "inconclusive" : "ok",
          data,
          evidence: [
            "Metadata inspected in the selected environment; apply rechecks the reviewed state before writing.",
          ],
          coverage: {
            complete: !unfinished,
            limitations: [
              "Only additive changes are supported. Dataverse required fields are application-level, not a server-side NOT NULL guarantee.",
            ],
          },
        },
        json,
        runtime,
      );
    }
    if (parsed.command === "tables list" || parsed.command === "query") {
      let data: unknown;
      let complete = true;
      if (parsed.command === "tables list")
        data = { tables: await tables(client, parsed.options.get("--search")) };
      else {
        const filterPath = parsed.options.get("--filter-file");
        const filter =
          filterPath === undefined
            ? undefined
            : await runtime.readFile(filterPath);
        const orderBy = parsed.options.get("--order-by");
        const rawLimit = parsed.options.get("--limit");
        const result = await query(client, {
          table: parsed.options.get("--table") ?? "",
          select: (parsed.options.get("--select") ?? "")
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
        json,
        runtime,
      );
    }
    if (selector !== undefined) {
      const roleId =
        parsed.command === "check role"
          ? await resolveRole(client, {
              ...(parsed.options.has("--role-id")
                ? { id: parsed.options.get("--role-id") ?? "" }
                : { name: parsed.options.get("--role") ?? "" }),
            })
          : undefined;
      const assignments = await userRoles(
        client,
        parsed.options.has("--caller")
          ? { field: "id", value: identity.applicationUserId }
          : selector,
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
        json,
        runtime,
      );
    }
    return emit(
      {
        ...base,
        caller: { id: identity.applicationUserId, kind: "application-user" },
        status: "ok",
        data:
          parsed.command === "doctor"
            ? {
                checks: [
                  { name: "configuration", status: "ok" },
                  { name: "token", status: "ok" },
                  { name: "WhoAmI", status: "ok" },
                ],
                identity,
              }
            : identity,
        evidence: ["Dataverse WhoAmI completed."],
        coverage: {
          complete: true,
          limitations: [
            "Only WhoAmI was probed; table, role, and record access were not checked.",
          ],
        },
      },
      json,
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
        ...(command === "doctor"
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
                        : code === "authentication"
                          ? "error"
                          : code === "invalid-input"
                            ? "not-run"
                            : "unknown",
                  },
                  {
                    name: "WhoAmI",
                    status:
                      stage === "configuration" ||
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
      json,
      runtime,
    );
  }
}

function parseArguments(argv: readonly string[]): ParsedArguments {
  const options = new Map<string, string>();
  const positionals: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === undefined) continue;
    const definition = optionDefinitions.find(
      (option) => option.name === argument,
    );
    if (definition !== undefined) {
      if (options.has(argument))
        throw new InputError(`Duplicate option ${argument}.`);
      let value = "true";
      if (definition.value !== null) {
        const supplied = argv[++index];
        if (
          supplied === undefined ||
          supplied === "" ||
          supplied.startsWith("--")
        )
          throw new InputError(`${argument} requires a value.`);
        value = supplied;
      }
      options.set(argument, value);
    } else if (argument.startsWith("-")) {
      throw new InputError(`Unknown option ${argument}.`);
    } else {
      positionals.push(argument);
    }
  }
  const command = commandDefinitions.find(
    (definition) => definition.path === positionals.join(" "),
  );
  if (command === undefined)
    throw new InputError("Unknown command. Use --help.");
  const allowedOptions = commandOptions(command.path);
  for (const name of options.keys()) {
    if (!allowedOptions.some((option) => option.name === name))
      throw new InputError(`Option ${name} is not valid for ${command.path}.`);
  }
  for (const option of allowedOptions) {
    if (optionRequired(option, command.path) && !options.has(option.name))
      throw new InputError(`${option.name} is required.`);
  }
  return {
    command: command.path,
    configPath: options.get("--config") ?? "unverse.config.json",
    environmentName: options.get("--env") ?? "",
    options,
  };
}

function userSelector(options: ReadonlyMap<string, string>): UserSelector {
  const selectors = [
    "--user-id",
    "--email",
    "--domain",
    "--name",
    "--caller",
  ].filter((option) => options.has(option));
  if (selectors.length !== 1)
    throw new InputError(
      "Select exactly one of --user-id, --email, --domain, --name, or --caller.",
    );
  const selected = selectors[0] ?? "";
  if (selected === "--caller")
    return { field: "id", value: "__authenticated_caller__" };
  return {
    field:
      selected === "--user-id"
        ? "id"
        : selected === "--email"
          ? "email"
          : selected === "--name"
            ? "name"
            : "domain",
    value: options.get(selected) ?? "",
  };
}

function emit(
  result: Result<unknown>,
  json: boolean,
  runtime: CliRuntime,
): number {
  if (json)
    runtime.writeOut(
      `${redactText(JSON.stringify(result), runtime.secrets)}\n`,
    );
  else if (result.status === "error")
    runtime.writeError(
      `${redactText(result.error?.message ?? "Command failed.", runtime.secrets)}\n`,
    );
  else
    runtime.writeOut(
      `${redactText(JSON.stringify(result, null, 2), runtime.secrets)}\n`,
    );
  return exitCodeFor(result);
}
