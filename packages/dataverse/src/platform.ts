import {
  acquireToken,
  type Collection,
  type Credential,
  collectPages,
  DataverseError,
  getWithRetry,
  type HttpTransport,
  type RetryClock,
} from "./client.js";
import { matches } from "./discovery.js";

const origin = "https://api.powerplatform.com";
const scope = `${origin}/.default`;
const appsVersion = "2024-10-01";
const flowsVersion = "2024-10-01";

export interface PlatformResource {
  readonly id: string;
  readonly name: string;
  readonly source: "platform";
  readonly kind?: string;
  readonly uniqueName?: string;
  readonly state?: number;
}

export class PlatformClient {
  constructor(
    private readonly environmentId: string,
    private readonly credential: Credential,
    private readonly transport: HttpTransport,
    private readonly clock: RetryClock,
  ) {}

  /** Power Apps namespace: Apps - Get AdminApps. */
  adminApps(): Promise<Collection> {
    return this.collect(
      `powerapps/environments/${this.environmentId}/apps`,
      appsVersion,
    );
  }

  /** Power Automate namespace: Cloud Flows - List Cloud Flows. */
  cloudFlows(): Promise<Collection> {
    return this.collect(
      `powerautomate/environments/${this.environmentId}/cloudFlows`,
      flowsVersion,
    );
  }

  private async collect(path: string, version: string): Promise<Collection> {
    const token = await acquireToken(this.credential, scope);
    const start = new URL(`${origin}/${path}`);
    start.searchParams.set("api-version", version);
    return collectPages(
      start.href,
      (url) =>
        getWithRetry(
          this.transport,
          this.clock,
          url,
          { Accept: "application/json" },
          token,
          "Power Platform API",
        ),
      "nextLink",
      (link) => {
        const url = new URL(link);
        if (url.origin !== origin || url.username !== "" || url.password !== "")
          throw new DataverseError(
            "service",
            "Rejected a continuation outside the authenticated Power Platform API.",
          );
        return url.href;
      },
      "Power Platform API",
    );
  }
}

export async function platformApps(
  client: PlatformClient,
  search?: string,
): Promise<readonly PlatformResource[]> {
  const result = await client.adminApps();
  return result.rows
    .map((row) => {
      const properties = optionalObject(row.properties);
      return {
        id: requiredText(row.name, "app name"),
        name: requiredText(properties?.displayName, "app displayName"),
        source: "platform" as const,
      };
    })
    .filter((row) => matches(search, row.name))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export async function platformFlows(
  client: PlatformClient,
  search?: string,
): Promise<readonly PlatformResource[]> {
  const result = await client.cloudFlows();
  return result.rows
    .map((row) => ({
      id: requiredText(row.workflowId, "flow workflowId"),
      name: requiredText(row.name, "flow name"),
      source: "platform" as const,
      kind: "cloud-flow",
      ...(typeof row.uniqueName === "string"
        ? { uniqueName: row.uniqueName }
        : {}),
      ...(typeof row.stateCode === "number" ? { state: row.stateCode } : {}),
    }))
    .filter((row) => matches(search, row.name, row.uniqueName ?? null))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

function optionalObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || value === "")
    throw new DataverseError(
      "service",
      `Power Platform API response is missing ${field}.`,
    );
  return value;
}
