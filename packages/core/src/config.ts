export interface EnvironmentProfile {
  readonly url: string;
  readonly tenantIdEnv: string;
  readonly clientIdEnv: string;
  readonly clientSecretEnv: string;
  readonly postgres?: PostgresProfile;
}

export interface PostgresProfile {
  readonly connectionStringEnv: string;
  readonly schema: string;
}

export function postgresSchemaName(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[a-z][a-z0-9_]{0,49}$/.test(value) ||
    value === "public" ||
    value.startsWith("pg_") ||
    value === "information_schema"
  )
    throw new ConfigValidationError(
      "A dedicated, non-system PostgreSQL schema is required.",
    );
  return value;
}

export interface UnverseConfig {
  readonly configVersion: 1;
  readonly environments: Readonly<Record<string, EnvironmentProfile>>;
}

export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigValidationError";
  }
}

export function parseConfig(value: unknown): UnverseConfig {
  const config = object(value, "Configuration must be an object.");
  if (config.configVersion !== 1) {
    throw new ConfigValidationError("configVersion must be 1.");
  }

  const environments = object(
    config.environments,
    "environments must be an object.",
  );
  const parsedEnvironments: Record<string, EnvironmentProfile> = {};
  for (const [name, profile] of Object.entries(environments)) {
    if (!environmentName.test(name)) {
      throw new ConfigValidationError(
        `Environment name ${JSON.stringify(name)} is invalid.`,
      );
    }
    parsedEnvironments[name] = parseProfile(profile, name);
  }

  if (Object.keys(parsedEnvironments).length === 0) {
    throw new ConfigValidationError(
      "environments must define at least one environment.",
    );
  }

  return { configVersion: 1, environments: parsedEnvironments };
}

export function selectEnvironment(
  config: UnverseConfig,
  name: string,
): EnvironmentProfile {
  const profile = Object.hasOwn(config.environments, name)
    ? config.environments[name]
    : undefined;
  if (profile === undefined) {
    throw new ConfigValidationError(
      `Environment ${JSON.stringify(name)} is not configured.`,
    );
  }
  return profile;
}

function parseProfile(value: unknown, name: string): EnvironmentProfile {
  const profile = object(
    value,
    `Environment ${JSON.stringify(name)} must be an object.`,
  );
  const postgres =
    profile.postgres === undefined
      ? undefined
      : object(profile.postgres, "postgres must be an object.");
  return {
    url: normalizeUrl(string(profile.url, name, "url")),
    tenantIdEnv: environmentReference(
      string(profile.tenantIdEnv, name, "tenantIdEnv"),
      name,
      "tenantIdEnv",
    ),
    clientIdEnv: environmentReference(
      string(profile.clientIdEnv, name, "clientIdEnv"),
      name,
      "clientIdEnv",
    ),
    clientSecretEnv: environmentReference(
      string(profile.clientSecretEnv, name, "clientSecretEnv"),
      name,
      "clientSecretEnv",
    ),
    ...(postgres === undefined
      ? {}
      : {
          postgres: {
            connectionStringEnv: environmentReference(
              string(
                postgres.connectionStringEnv,
                name,
                "postgres.connectionStringEnv",
              ),
              name,
              "postgres.connectionStringEnv",
            ),
            schema: postgresSchemaName(postgres.schema),
          },
        }),
  };
}

function normalizeUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigValidationError(
      "Environment url must be an absolute HTTPS URL.",
    );
  }

  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    (url.pathname !== "" && url.pathname !== "/")
  ) {
    throw new ConfigValidationError(
      "Environment url must be an origin-only HTTPS URL.",
    );
  }
  return url.origin;
}

function object(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ConfigValidationError(message);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, environment: string, field: string): string {
  if (typeof value !== "string" || value === "") {
    throw new ConfigValidationError(
      `Environment ${JSON.stringify(environment)} field ${field} must be a non-empty string.`,
    );
  }
  return value;
}

function environmentReference(
  value: string,
  environment: string,
  field: string,
): string {
  if (!environmentVariable.test(value)) {
    throw new ConfigValidationError(
      `Environment ${JSON.stringify(environment)} field ${field} must name an environment variable.`,
    );
  }
  return value;
}

const environmentName = /^[a-z][a-z0-9-]*$/;
const environmentVariable = /^[A-Z_][A-Z0-9_]*$/;
