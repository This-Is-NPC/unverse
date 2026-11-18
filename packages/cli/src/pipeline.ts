import { basename, extname, isAbsolute, join, resolve } from "node:path";
import {
  type DesiredData,
  type EnvironmentProfile,
  SchemaError,
  seedId,
  selectEnvironment,
  type UnverseConfig,
} from "@unverse/core";
import { type DataverseClient, DataverseError } from "@unverse/dataverse";
import { InputError, parseCommand } from "./arguments.js";
import { builtinPipelines } from "./builtins.js";
import { type FlagSpec, type Route, resources } from "./commands.js";
import type { CliRuntime } from "./run.js";

export interface PipelineContext {
  readonly params: Readonly<Record<string, string | boolean>>;
  readonly target: string;
  readonly read: (
    environment: string,
    path: string,
  ) => Promise<readonly Record<string, unknown>[]>;
  readonly readJson: (path: string) => Promise<unknown>;
  readonly seedId: (
    namespace: string,
    entity: string,
    key: string,
  ) => Promise<string>;
}

export interface Pipeline {
  readonly description: string;
  readonly params?: readonly FlagSpec[];
  readonly run: (context: PipelineContext) => Promise<DesiredData>;
}

export interface PipelineEntry {
  readonly name: string;
  readonly origin: "built-in" | "project" | "file";
  readonly path?: string;
  readonly load: () => Promise<Pipeline>;
}

type PipelineRuntime = Pick<
  CliRuntime,
  "cwd" | "fileExists" | "readFile" | "listDirectory" | "loadModule" | "connect"
>;

const extensions = [".ts", ".mjs"];
const nameRule = /^[a-z][a-z\d-]*$/;

export function isPipelinePath(argument: string): boolean {
  return /[\\/]/.test(argument) || extensions.includes(extname(argument));
}

function validPipeline(path: string, value: unknown): Pipeline {
  const fail = (reason: string) =>
    new InputError(`${path} is not a pipeline: ${reason}.`);
  if (typeof value !== "object" || value === null)
    throw fail("export default { description, params, run }");
  const { description, params, run } = value as Record<string, unknown>;
  if (typeof description !== "string" || description === "")
    throw fail("description must be a non-empty string");
  if (typeof run !== "function") throw fail("run must be a function");
  const flags = params === undefined ? [] : params;
  if (!Array.isArray(flags)) throw fail("params must be an array of flags");
  const names = new Set<string>();
  for (const flag of flags as Record<string, unknown>[]) {
    if (
      typeof flag !== "object" ||
      flag === null ||
      typeof flag.name !== "string" ||
      !/^--[a-z][a-z\d-]*$/.test(flag.name) ||
      flag.name === "--help" ||
      names.has(flag.name) ||
      (flag.value !== null && typeof flag.value !== "string") ||
      typeof flag.summary !== "string" ||
      (flag.required !== undefined && typeof flag.required !== "boolean") ||
      (flag.choices !== undefined &&
        (!Array.isArray(flag.choices) ||
          flag.choices.some((choice) => typeof choice !== "string")))
    )
      throw fail(
        "each param needs a unique --name, a value placeholder or null, and a summary",
      );
    names.add(flag.name);
  }
  return value as Pipeline;
}

async function loadFile(
  runtime: PipelineRuntime,
  path: string,
): Promise<Pipeline> {
  let module: unknown;
  try {
    module = await runtime.loadModule(path);
  } catch (error) {
    throw new InputError(
      `Loading ${path} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return validPipeline(path, (module as { default?: unknown }).default);
}

export async function pipelineEntries(
  runtime: PipelineRuntime,
  root: string,
): Promise<readonly PipelineEntry[]> {
  const builtins = builtinPipelines(runtime.readFile, root);
  const entries: PipelineEntry[] = Object.entries(builtins).map(
    ([name, pipeline]) => ({
      name,
      origin: "built-in",
      load: async () => pipeline,
    }),
  );
  const directory = join(root, ".unverse", "pipelines");
  if (!(await runtime.fileExists(directory))) return entries;
  const found = new Set<string>();
  for (const file of [...(await runtime.listDirectory(directory))].sort()) {
    const extension = extname(file);
    if (!extensions.includes(extension)) continue;
    const name = basename(file, extension);
    if (Object.hasOwn(builtins, name))
      throw new InputError(
        `${join(directory, file)} would shadow the built-in pipeline ${name}; rename it.`,
      );
    if (!nameRule.test(name))
      throw new InputError(
        `${join(directory, file)} has an invalid pipeline name; use lowercase letters, digits, and hyphens.`,
      );
    if (found.has(name))
      throw new InputError(
        `Pipeline ${name} exists as both .ts and .mjs in ${directory}.`,
      );
    found.add(name);
    const path = join(directory, file);
    entries.push({
      name,
      origin: "project",
      path,
      load: () => loadFile(runtime, path),
    });
  }
  return entries;
}

export async function resolvePipeline(
  runtime: PipelineRuntime,
  root: string,
  argument: string,
): Promise<PipelineEntry> {
  if (isPipelinePath(argument)) {
    const path = resolve(runtime.cwd, argument);
    return {
      name: basename(path, extname(path)),
      origin: "file",
      path,
      load: () => loadFile(runtime, path),
    };
  }
  const found = (await pipelineEntries(runtime, root)).find(
    (entry) => entry.name === argument,
  );
  if (found === undefined)
    throw new InputError(
      `Unknown pipeline ${argument}; unverse pipeline list shows the available names.`,
    );
  return found;
}

export function pipelineRoute(entry: PipelineEntry, pipeline: Pipeline): Route {
  return {
    path: `pipeline plan ${entry.name} --`,
    resource: resources.find(({ name }) => name === "pipeline"),
    command: {
      name: entry.name,
      stage: "plan",
      effect: "read",
      summary: pipeline.description,
      flagsets: [],
      flags: pipeline.params ?? [],
      outputs: [],
    },
  };
}

export function pipelineParams(
  route: Route,
  rest: readonly string[],
): PipelineContext["params"] {
  const { flags } = parseCommand(route, rest);
  return Object.fromEntries(
    (route.command.flags ?? []).flatMap((flag) => {
      const value = flags.get(flag.name);
      return value === undefined
        ? []
        : [[flag.name.slice(2), flag.value === null ? true : value]];
    }),
  );
}

export async function preparePipeline(
  runtime: PipelineRuntime,
  root: string,
  argument: string,
  rest: readonly string[],
) {
  const entry = await resolvePipeline(runtime, root, argument);
  const pipeline = await entry.load();
  const route = pipelineRoute(entry, pipeline);
  const requested = rest.some((token) => token === "-h" || token === "--help");
  return {
    entry,
    pipeline,
    route,
    params: requested ? undefined : pipelineParams(route, rest),
  };
}

export function createContext(
  runtime: PipelineRuntime,
  options: {
    readonly configuration: UnverseConfig;
    readonly root: string;
    readonly target: string;
    readonly targetClient: DataverseClient;
    readonly params: PipelineContext["params"];
  },
): PipelineContext {
  const clients = new Map([[options.target, options.targetClient]]);
  return Object.freeze({
    params: options.params,
    target: options.target,
    read: async (environment: string, path: string) => {
      let client = clients.get(environment);
      if (client === undefined) {
        if (runtime.connect === undefined)
          throw new DataverseError(
            "unsupported",
            "Dataverse operations are unavailable in this runtime.",
          );
        const profile: EnvironmentProfile = selectEnvironment(
          options.configuration,
          environment,
        );
        client = runtime.connect(profile, environment);
        clients.set(environment, client);
      }
      return (await client.collect(path)).rows;
    },
    readJson: async (path: string) =>
      JSON.parse(
        await runtime.readFile(
          isAbsolute(path) ? path : join(options.root, path),
        ),
      ),
    seedId,
  });
}

export async function runPipeline(
  name: string,
  pipeline: Pipeline,
  context: PipelineContext,
): Promise<DesiredData> {
  try {
    return await pipeline.run(context);
  } catch (error) {
    if (
      error instanceof DataverseError ||
      error instanceof SchemaError ||
      error instanceof InputError
    )
      throw error;
    throw new InputError(
      `Pipeline ${name} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
