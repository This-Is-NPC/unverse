import { basename, dirname, join } from "node:path";
import { InputError } from "./arguments.js";

export const configFile = join(".unverse", "config.json");
export const artifactsFile = join(".unverse", "artifacts.json");

export interface ProjectRuntime {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly fileExists: (path: string) => Promise<boolean>;
}

export interface Resolved {
  readonly value: string;
  readonly origin: string;
}

function variable(runtime: ProjectRuntime, name: string): string | undefined {
  const value = runtime.env[name];
  return value === undefined || value === "" ? undefined : value;
}

async function searchUp(
  runtime: ProjectRuntime,
  file: string,
): Promise<string | undefined> {
  let directory = runtime.cwd;
  for (;;) {
    const candidate = join(directory, file);
    if (await runtime.fileExists(candidate)) return candidate;
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

export async function resolveConfigPath(
  flags: ReadonlyMap<string, string>,
  runtime: ProjectRuntime,
): Promise<Resolved> {
  const flag = flags.get("--config");
  if (flag !== undefined) return { value: flag, origin: "from --config" };
  const named = variable(runtime, "UNVERSE_CONFIG");
  if (named !== undefined)
    return { value: named, origin: "from UNVERSE_CONFIG" };
  const found = await searchUp(runtime, configFile);
  if (found !== undefined)
    return {
      value: found,
      origin: `found by searching up from ${runtime.cwd}`,
    };
  throw new InputError(
    `No ${configFile} found from ${runtime.cwd} up to the filesystem root. Run unverse init to create one here, or pass --config or set UNVERSE_CONFIG.`,
  );
}

export async function resolveArtifactsPath(
  flags: ReadonlyMap<string, string>,
  runtime: ProjectRuntime,
): Promise<Resolved | undefined> {
  const flag = flags.get("--artifacts-file");
  if (flag !== undefined)
    return { value: flag, origin: "from --artifacts-file" };
  const found = await searchUp(runtime, artifactsFile);
  return found === undefined
    ? undefined
    : {
        value: found,
        origin: `found by searching up from ${runtime.cwd}`,
      };
}

export function resolveEnvironmentName(
  flags: ReadonlyMap<string, string>,
  runtime: ProjectRuntime,
): Resolved {
  const flag = flags.get("--env");
  if (flag !== undefined) return { value: flag, origin: "--env" };
  const named = variable(runtime, "UNVERSE_ENV");
  if (named !== undefined) return { value: named, origin: "UNVERSE_ENV" };
  throw new InputError(
    "An environment is required: pass --env or set UNVERSE_ENV.",
  );
}

export const configTemplate = `${JSON.stringify(
  {
    configVersion: 1,
    environments: {
      dev: {
        url: "https://your-org.crm.dynamics.com",
        tenantIdEnv: "UNVERSE_TENANT_ID",
        clientIdEnv: "UNVERSE_CLIENT_ID",
        clientSecretEnv: "UNVERSE_CLIENT_SECRET",
      },
    },
  },
  null,
  2,
)}\n`;

export function projectRoot(configPath: string): string {
  const directory = dirname(configPath);
  return basename(directory) === ".unverse" ? dirname(directory) : directory;
}
