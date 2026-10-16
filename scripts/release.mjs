#!/usr/bin/env node
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { installConsumer } from "./lib/consumer.mjs";

const root = process.env.MISE_PROJECT_ROOT ?? process.cwd();
const consumer = installConsumer(root);
try {
  const version = JSON.parse(
    readFileSync(resolve(root, "package.json"), "utf8"),
  ).version;
  const destination = resolve(root, "release", version);
  mkdirSync(destination, { recursive: true });
  const checksums = [];
  for (const source of consumer.tarballs) {
    const name = basename(source);
    cpSync(source, resolve(destination, name));
    checksums.push(
      `${createHash("sha256").update(readFileSync(source)).digest("hex")}  ${name}`,
    );
  }
  cpSync(resolve(root, "LICENSE"), resolve(destination, "LICENSE"));
  writeFileSync(
    resolve(destination, "SHA256SUMS"),
    `${checksums.join("\n")}\n`,
  );
  console.log(
    `Prepared local candidate release/${version}; nothing published.`,
  );
} finally {
  consumer.dispose();
}
