import { dirname, join } from "node:path";
import { InputError } from "./arguments.js";

export const configFile = join(".unverse", "config.json");

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

export async function resolveConfigPath(
  flags: ReadonlyMap<string, string>,
  runtime: ProjectRuntime,
): Promise<Resolved> {
  const flag = flags.get("--config");
  if (flag !== undefined) return { value: flag, origin: "from --config" };
  const named = variable(runtime, "UNVERSE_CONFIG");
  if (named !== undefined)
    return { value: named, origin: "from UNVERSE_CONFIG" };
  let directory = runtime.cwd;
  for (;;) {
    const candidate = join(directory, configFile);
    if (await runtime.fileExists(candidate))
      return {
        value: candidate,
        origin: `found by searching up from ${runtime.cwd}`,
      };
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new InputError(
    `No ${configFile} found from ${runtime.cwd} up to the filesystem root. Run unverse init to create one here, or pass --config or set UNVERSE_CONFIG.`,
  );
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
