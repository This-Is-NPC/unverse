import { ClientSecretCredential } from "@azure/identity";
import type { EnvironmentProfile } from "@unverse/core";
import {
  type Credential,
  DataverseClient,
  DataverseError,
  type HttpResponse,
  type HttpTransport,
  type RetryClock,
} from "@unverse/dataverse";

export function createDataverseClient(
  profile: EnvironmentProfile,
  environment: Readonly<Record<string, string | undefined>> = process.env,
  pageSize = 5000,
  transport: HttpTransport = fetchTransport,
): DataverseClient {
  const credential = createCredential(profile, environment);
  return new DataverseClient(
    profile.url,
    credential,
    transport,
    systemClock,
    pageSize,
  );
}

function createCredential(
  profile: EnvironmentProfile,
  environment: Readonly<Record<string, string | undefined>>,
): Credential {
  const tenantId = requiredEnvironmentValue(profile.tenantIdEnv, environment);
  const clientId = requiredEnvironmentValue(profile.clientIdEnv, environment);
  const clientSecret = requiredEnvironmentValue(
    profile.clientSecretEnv,
    environment,
  );
  const credential = new ClientSecretCredential(
    tenantId,
    clientId,
    clientSecret,
  );
  return {
    async getToken(scope: string): Promise<string> {
      const token = await credential.getToken(scope);
      if (token === null)
        throw new Error("Microsoft Entra ID returned no access token.");
      return token.token;
    },
  };
}

export const fetchTransport: HttpTransport = {
  get: (url, headers) => send("GET", url, headers),
  request: send,
};

async function send(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: string,
  headers: Readonly<Record<string, string>>,
  body?: string,
): Promise<HttpResponse> {
  const response = await fetch(url, {
    method,
    headers,
    ...(body === undefined ? {} : { body }),
    redirect: "error",
    signal: AbortSignal.timeout(method === "GET" ? 30_000 : 180_000),
  });
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body: await response.text(),
  };
}

const systemClock: RetryClock = {
  now: () => Date.now(),
  wait: (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
};

export function requiredEnvironmentValue(
  name: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const value = environment[name];
  if (value === undefined || value === "") {
    throw new DataverseError(
      "invalid-input",
      `Environment variable ${name} is required.`,
    );
  }
  return value;
}
