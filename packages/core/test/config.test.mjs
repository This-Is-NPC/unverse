import assert from "node:assert/strict";
import test from "node:test";

import {
  ConfigValidationError,
  exitCodeFor,
  parseConfig,
  redactText,
  selectEnvironment,
} from "../dist/index.js";

const profile = {
  url: "https://Example.crm.dynamics.com/",
  tenantIdEnv: "UNVERSE_TENANT_ID",
  clientIdEnv: "UNVERSE_CLIENT_ID",
  clientSecretEnv: "UNVERSE_CLIENT_SECRET",
};

test("normalizes the selected environment URL", () => {
  const config = parseConfig({
    configVersion: 1,
    environments: { dev: profile },
  });
  assert.equal(
    selectEnvironment(config, "dev").url,
    "https://example.crm.dynamics.com",
  );
});

test("rejects an incomplete profile", () => {
  assert.throws(
    () =>
      parseConfig({
        configVersion: 1,
        environments: { dev: { ...profile, clientIdEnv: "" } },
      }),
    ConfigValidationError,
  );
});

test("maps status and errors to stable exit codes", () => {
  assert.equal(exitCodeFor({ status: "failed" }), 1);
  assert.equal(exitCodeFor({ status: "inconclusive" }), 7);
  assert.equal(
    exitCodeFor({ status: "error", error: { code: "permission" } }),
    4,
  );
});

test("redacts known secrets", () => {
  assert.equal(
    redactText("Token is top-secret", ["top-secret"]),
    "Token is [REDACTED]",
  );
});

test("rejects inherited environment names", () => {
  const config = parseConfig({
    configVersion: 1,
    environments: { dev: profile },
  });
  assert.throws(
    () => selectEnvironment(config, "constructor"),
    ConfigValidationError,
  );
});
