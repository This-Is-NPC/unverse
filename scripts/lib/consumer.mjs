import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

export function run(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    timeout: 120_000,
  });
  assert.equal(
    result.status,
    0,
    `${command} failed (${result.status}):\n${result.stdout}\n${result.stderr}`,
  );
  return result.stdout;
}

export function installConsumer(root) {
  const directory = mkdtempSync(`${process.env.TMPDIR}/unverse-consumer-`);
  try {
    const dependencies = {};
    const dependencyLock = {};
    const tarballs = [];
    for (const name of readdirSync(resolve(root, "packages"))) {
      const metadata = JSON.parse(
        readFileSync(resolve(root, "packages", name, "package.json"), "utf8"),
      );
      const [entry] = JSON.parse(
        run(
          "npm",
          [
            "pack",
            "--ignore-scripts",
            "--json",
            "--workspace",
            metadata.name,
            "--pack-destination",
            directory,
          ],
          root,
        ),
      );
      assert.ok(entry.files.some((file) => file.path === "dist/LICENSE"));
      assert.ok(entry.files.some((file) => file.path.endsWith(".js")));
      assert.ok(
        entry.files.every(
          (file) =>
            !/(?:^|\/)(?:src|test)\//.test(file.path) &&
            !file.path.endsWith(".tsbuildinfo"),
        ),
      );
      const tarball = resolve(directory, entry.filename);
      tarballs.push(tarball);
      dependencies[metadata.name] = `file:${tarball}`;
      dependencyLock[`node_modules/${metadata.name}`] = {
        version: metadata.version,
        resolved: `file:${tarball}`,
        integrity: entry.integrity,
        ...(metadata.dependencies === undefined
          ? {}
          : { dependencies: metadata.dependencies }),
        ...(metadata.bin === undefined ? {} : { bin: metadata.bin }),
      };
    }
    const consumer = {
      name: "unverse-package-consumer",
      private: true,
      type: "module",
      dependencies,
    };
    const locked = JSON.parse(
      readFileSync(resolve(root, "package-lock.json"), "utf8"),
    );
    const packages = Object.fromEntries(
      Object.entries(locked.packages).filter(
        ([path, metadata]) =>
          path.startsWith("node_modules/") &&
          !path.startsWith("node_modules/@unverse/") &&
          !metadata.dev,
      ),
    );
    writeFileSync(resolve(directory, "package.json"), JSON.stringify(consumer));
    writeFileSync(
      resolve(directory, "package-lock.json"),
      JSON.stringify({
        name: consumer.name,
        lockfileVersion: 3,
        requires: true,
        packages: { "": consumer, ...packages, ...dependencyLock },
      }),
    );
    cpSync(resolve(root, ".cache/npm"), resolve(directory, "npm-cache"), {
      recursive: true,
    });
    run(
      "npm",
      [
        "ci",
        "--cache",
        resolve(directory, "npm-cache"),
        "--offline",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
      ],
      directory,
    );
    return {
      directory,
      tarballs,
      executable: resolve(directory, "node_modules/.bin/unverse"),
      dispose: () => rmSync(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}
