#!/usr/bin/env node
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { installConsumer, run } from "./lib/consumer.mjs";
import { scenes, stageScenes, startBrowser } from "./lib/scenes.mjs";

const root = process.env.MISE_PROJECT_ROOT ?? process.cwd();
const consumer = installConsumer(root);
let browser;
try {
  const environment = await stageScenes(root, consumer);
  browser = await startBrowser(root);
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  await page.route("**/*", (route) => route.abort());
  const font = readFileSync(
    resolve(
      root,
      "node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2",
    ),
  ).toString("base64");
  mkdirSync(resolve(root, "docs/img"), { recursive: true });
  const names = process.env.usage_only?.split(",");
  const selected = names
    ? scenes.filter((scene) => names.includes(scene.name))
    : scenes;
  if (
    selected.length === 0 ||
    (names !== undefined && selected.length !== names.length)
  )
    throw new Error("Unknown or duplicate screen scene.");
  for (const scene of selected) {
    const output = run(
      consumer.executable,
      scene.args,
      consumer.directory,
      environment,
    );
    if (scene.render === "html") {
      await page.setContent(output);
      await page.waitForFunction(() => document.body.dataset.ready === "true");
      await page.screenshot({
        path: resolve(root, `docs/img/${scene.name}.png`),
        fullPage: true,
        animations: "disabled",
      });
      console.log(`Generated docs/img/${scene.name}.png`);
      continue;
    }
    if (scene.render === "svg") {
      await page.setContent(
        `<!doctype html><body style="margin:0">${output}</body>`,
      );
      await page.locator("svg").screenshot({
        path: resolve(root, `docs/img/${scene.name}.png`),
        animations: "disabled",
      });
      console.log(`Generated docs/img/${scene.name}.png`);
      continue;
    }
    await page.setContent(
      `<!doctype html><style>@font-face{font-family:FixtureMono;src:url(data:font/woff2;base64,${font})}*{box-sizing:border-box}body{margin:0;background:#111827;color:#d1fae5;padding:32px}pre{font:14px/1.5 FixtureMono;white-space:pre-wrap;overflow-wrap:anywhere;margin:0}header{font:16px FixtureMono;color:#93c5fd;margin-bottom:24px}</style><header>Unverse · synthetic offline fixture</header><pre></pre>`,
    );
    await page.locator("pre").evaluate(
      (element, text) => {
        element.textContent = text;
      },
      `$ unverse ${scene.args.join(" ")}\n\n${output}`,
    );
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: resolve(root, `docs/img/${scene.name}.png`),
      fullPage: true,
      animations: "disabled",
    });
    console.log(`Generated docs/img/${scene.name}.png`);
  }
} finally {
  await browser?.close();
  consumer.dispose();
}
