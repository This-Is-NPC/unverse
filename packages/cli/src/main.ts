#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { PostgresStore } from "@unverse/postgres";
import {
  createDataverseClient,
  requiredEnvironmentValue,
} from "./node-dataverse.js";
import { runCli } from "./run.js";

const secretValues = Object.entries(process.env).flatMap(([name, value]) =>
  /(?:secret|token|password)/i.test(name) && value !== undefined ? [value] : [],
);

const exitCode = await runCli(process.argv.slice(2), {
  readFile: (path) => readFile(path, "utf8"),
  now: () => new Date().toISOString(),
  writeOut: (line) => process.stdout.write(line),
  writeError: (line) => process.stderr.write(line),
  secrets: secretValues,
  connect: (profile) => {
    const secret = process.env[profile.clientSecretEnv];
    if (secret !== undefined) secretValues.push(secret);
    return createDataverseClient(profile);
  },
  connectPostgres: (profile) => {
    const connection = requiredEnvironmentValue(profile.connectionStringEnv);
    secretValues.push(connection);
    try {
      const password = new URL(connection).password;
      if (password !== "")
        secretValues.push(password, decodeURIComponent(password));
    } catch {
      /* The driver validates non-URL connection strings. */
    }
    return new PostgresStore(connection, profile.schema);
  },
});
process.exitCode = exitCode;
