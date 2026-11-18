#!/usr/bin/env node
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { PostgresStore } from "@unverse/postgres";
import {
  createDataverseClient,
  createPlatformClient,
  requiredEnvironmentValue,
} from "./node-dataverse.js";
import { runCli } from "./run.js";

const secretValues = Object.entries(process.env).flatMap(([name, value]) =>
  /(?:secret|token|password)/i.test(name) && value !== undefined ? [value] : [],
);

const exitCode = await runCli(process.argv.slice(2), {
  readFile: (path) => readFile(path, "utf8"),
  writeFile: async (path, content) => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, { flag: "wx" });
  },
  fileExists: (path) =>
    access(path).then(
      () => true,
      () => false,
    ),
  listDirectory: (path) => readdir(path),
  loadModule: (path) => import(pathToFileURL(path).href),
  cwd: process.cwd(),
  env: process.env,
  now: () => new Date().toISOString(),
  writeOut: (line) => process.stdout.write(line),
  writeError: (line) => process.stderr.write(line),
  secrets: secretValues,
  connect: (profile, name) => {
    const secret = process.env[profile.clientSecretEnv];
    if (secret !== undefined) secretValues.push(secret);
    return createDataverseClient(profile, name);
  },
  connectPlatform: (profile, platformEnvironmentId) => {
    const secret = process.env[profile.clientSecretEnv];
    if (secret !== undefined) secretValues.push(secret);
    return createPlatformClient(profile, platformEnvironmentId);
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
