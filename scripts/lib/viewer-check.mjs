import assert from "node:assert/strict";

export async function checkViewer(page, html, graph) {
  const requests = [];
  const errors = [];
  page.on("request", (request) => requests.push(request.url()));
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => route.abort());
  await page.setContent(html);
  await page.waitForFunction(() => document.body.dataset.ready !== "false");
  assert.equal(
    await page.locator("body").getAttribute("data-ready"),
    "true",
    await page.locator("#inspector").textContent(),
  );
  const captured = JSON.parse(await page.locator("#graph-data").textContent());
  assert.deepEqual(captured.graph, graph);
  assert.equal((await page.locator("#canvas canvas").count()) > 0, true);
  assert.match(
    await page.locator("#view-summary").textContent(),
    /Grouped overview/,
  );
  const grouped = await page.locator("#minimap circle").count();
  assert.ok(
    grouped < graph.nodes.length,
    "Overview must collapse artifacts rather than expose every node",
  );
  const canvasBox = await page.locator("#canvas").boundingBox();
  const coordinates = await page.evaluate(() => {
    const circle = document.querySelector("#minimap circle[data-group]");
    const view = document.getElementById("mini-viewport");
    const value = (node, key) => Number(node.getAttribute(key));
    return {
      x: (value(circle, "cx") - value(view, "x")) / value(view, "width"),
      y: (value(circle, "cy") - value(view, "y")) / value(view, "height"),
    };
  });
  await page.mouse.click(
    canvasBox.x + coordinates.x * canvasBox.width,
    canvasBox.y + coordinates.y * canvasBox.height,
  );
  await page.getByRole("button", { name: /^Expand group/ }).click();
  assert.match(
    await page.locator("#view-summary").textContent(),
    /Expanded view/,
    "Clicking a group must allow expansion",
  );
  await page.locator("#overview").click();
  const before = await page.locator("#zoom-label").textContent();
  await page.locator("#zoom-in").click();
  assert.notEqual(
    await page.locator("#zoom-label").textContent(),
    before,
    "Zoom button must change canvas scale",
  );
  const box = await page.locator("#canvas").boundingBox();
  const wheelBefore = await page.locator("#zoom-label").textContent();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -180);
  await page.waitForFunction(
    (old) => document.getElementById("zoom-label").textContent !== old,
    wheelBefore,
  );
  const panBefore = await page.locator("#mini-viewport").getAttribute("x");
  await page.mouse.move(box.x + 4, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 55, box.y + box.height / 2 + 20, { steps: 5 });
  await page.mouse.up();
  assert.notEqual(
    await page.locator("#mini-viewport").getAttribute("x"),
    panBefore,
    "Background drag must pan canvas",
  );
  const viewportBefore = await page.locator("#mini-viewport").getAttribute("x");
  await page.locator("#canvas").focus();
  await page.keyboard.press("ArrowRight");
  assert.notEqual(
    await page.locator("#mini-viewport").getAttribute("x"),
    viewportBefore,
    "Keyboard pan must move viewport",
  );
  await page.locator("#expand-all").click();
  assert.equal(
    await page.locator("#minimap circle").count(),
    graph.nodes.length,
    "Expand must expose all captured artifacts",
  );
  const boxed = await page.evaluate(() => {
    const value = (node, key) => Number(node.getAttribute(key));
    const boxes = [
      ...document.querySelectorAll("#minimap rect:not(#mini-viewport)"),
    ];
    return [...document.querySelectorAll("#minimap circle")].filter((circle) =>
      boxes.some(
        (box) =>
          value(circle, "cx") > value(box, "x") &&
          value(circle, "cx") < value(box, "x") + value(box, "width") &&
          value(circle, "cy") > value(box, "y") &&
          value(circle, "cy") < value(box, "y") + value(box, "height"),
      ),
    ).length;
  });
  assert.ok(boxed >= 2, "Expanded artifacts must sit inside type boxes");
  const target = graph.nodes.find((node) => node.kind !== "solution");
  await page.locator("#search").fill(target.objectId);
  assert.ok(
    (await page.locator("#search-results button").count()) > 0,
    "Search must resolve captured object IDs",
  );
  await page.locator("#search-results button").first().click();
  assert.equal(
    await page.locator("#inspector h2").textContent(),
    target.label,
    "Selection must retain the full metadata label as text",
  );
  assert.ok(
    (await page.locator("#inspector").textContent()).includes(target.objectId),
  );
  await page
    .getByRole("button", { name: "Focus neighbors", exact: true })
    .click();
  assert.match(
    await page.locator("#view-summary").textContent(),
    /Neighborhood/,
  );
  await page.locator("#overview").click();
  assert.equal(await page.locator("#minimap circle").count(), grouped);
  assert.equal(await page.locator("#filters-panel").isHidden(), true);
  await page.locator("#filters-toggle").click();
  const filter = page.locator("#filters input").first();
  await filter.uncheck();
  assert.ok(
    (await page.locator("#minimap circle").count()) < grouped,
    "Type filters must remove visible nodes",
  );
  await filter.check();
  assert.equal(await page.locator("#minimap circle").count(), grouped);
  assert.match(
    await page.locator("#coverage-status").textContent(),
    graph.closureComplete ? /completed/ : /Incomplete/,
  );
  assert.equal(
    await page.locator("iframe,object,embed,image,script[src],link").count(),
    0,
  );
  assert.deepEqual(requests, []);
  assert.deepEqual(errors, []);
}
