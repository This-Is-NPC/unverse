import test from "node:test";
import { dependencyHtml } from "@unverse/core";
import { startBrowser } from "../../../scripts/lib/scenes.mjs";
import { checkViewer } from "../../../scripts/lib/viewer-check.mjs";
import { dependencyGraph } from "../dist/index.js";
import {
  dependencyEnvironment,
  dependencyFixture,
  referenceId,
} from "./fixtures/dependencies.mjs";

test("offline dependency canvas groups, navigates, searches and filters captured artifacts", async () => {
  const graph = await dependencyGraph(
    dependencyFixture().client,
    { referenceId, direction: "both", depth: 1 },
    dependencyEnvironment,
  );
  const hostile = {
    ...graph,
    nodes: graph.nodes.map((node) => ({
      ...node,
      label: `${node.label} </script><img src=https://hostile.invalid onerror=alert(1)>`,
    })),
  };
  const browser = await startBrowser(process.cwd());
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    });
    await checkViewer(page, dependencyHtml(hostile), hostile);
  } finally {
    await browser.close();
  }
});
