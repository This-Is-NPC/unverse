#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";

const root = process.env.MISE_PROJECT_ROOT ?? process.cwd();
const result = await build({
  entryPoints: [resolve(root, "packages/core/src/dependency-viewer.ts")],
  bundle: true,
  platform: "browser",
  format: "iife",
  minify: true,
  write: false,
  legalComments: "inline",
  target: "es2024",
});
const license = readFileSync(
  resolve(root, "node_modules/cytoscape/LICENSE"),
  "utf8",
);
const script =
  `/*! Cytoscape.js 3.34.4\n${license.replaceAll("*/", "* /")}\n*/\n${result.outputFiles[0].text}`.replace(
    /<\/script/gi,
    "<\\/script",
  );
const hash = createHash("sha256").update(script).digest("base64");
mkdirSync(resolve(root, "packages/core/dist"), { recursive: true });
writeFileSync(
  resolve(root, "packages/core/dist/viewer-script.js"),
  `export const viewerScript = ${JSON.stringify(script)};\nexport const viewerScriptHash = ${JSON.stringify(hash)};\n`,
);
