import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import {
  createDataverseClient,
  fetchTransport,
} from "../../packages/cli/dist/node-dataverse.js";
import {
  parseConfig,
  selectEnvironment,
} from "../../packages/core/dist/index.js";

export function connectDev(pageSize = 5000, transport = fetchTransport) {
  const file = process.env.UNVERSE_LIVE_ENV_FILE;
  assert.ok(
    file,
    "Set UNVERSE_LIVE_ENV_FILE to the explicitly approved DEV file.",
  );
  const values = parseEnv(readFileSync(file, "utf8"));
  const origin = (value) => new URL(value).origin;
  assert.ok(
    values.DATAVERSE_DEV_URL,
    "DATAVERSE_DEV_URL is required; no fallback is allowed.",
  );
  const development = origin(values.DATAVERSE_DEV_URL);
  for (const name of [
    "DATAVERSE_PROD_URL",
    "DATAVERSE_TEST_URL",
    "DATAVERSE_URL",
  ]) {
    if (values[name] && development === origin(values[name]))
      throw new Error("DEV must be distinct from other environments.");
  }
  const configuration = parseConfig({
    configVersion: 1,
    environments: {
      dev: {
        url: development,
        tenantIdEnv: "DATAVERSE_TENANT_ID",
        clientIdEnv: "DATAVERSE_CLIENT_ID",
        clientSecretEnv: "DATAVERSE_CLIENT_SECRET",
      },
    },
  });
  return {
    client: createDataverseClient(
      selectEnvironment(configuration, "dev"),
      values,
      pageSize,
      transport,
    ),
    url: development,
  };
}

export function reportLiveError(error, details = false) {
  const code =
    typeof error?.code === "string" && /^[a-z-]+$/.test(error.code)
      ? error.code
      : "verification";
  console.error(`DEV verification failed (${code}).`);
  const diagnostic =
    error instanceof Error
      ? error.message.match(
          /AADSTS\d+|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|CERT_[A-Z_]+/gi,
        )
      : null;
  if (diagnostic !== null)
    console.error(
      `Public diagnostic codes: ${[...new Set(diagnostic)].join(", ")}.`,
    );
  if (details && error instanceof Error) {
    let message = error.message;
    const values = parseEnv(
      readFileSync(process.env.UNVERSE_LIVE_ENV_FILE, "utf8"),
    );
    for (const value of Object.values(values)
      .filter(Boolean)
      .sort((a, b) => b.length - a.length))
      message = message
        .replaceAll(value, "[REDACTED]")
        .replaceAll(encodeURIComponent(value), "[REDACTED]");
    message = message
      .replace(/https?:\/\/\S+/gi, "[URL]")
      .replace(
        /[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}/gi,
        "[ID]",
      );
    console.error(`Sanitized fixture diagnostic: ${message.slice(0, 800)}`);
  }
  process.exitCode = 1;
}
