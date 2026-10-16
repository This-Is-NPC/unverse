import cytoscape, {
  type Core,
  type ElementDefinition,
  type NodeSingular,
  type StylesheetJson,
} from "cytoscape";
import type {
  analyzeDependencies,
  DependencyGraph,
  DependencyNode,
} from "./dependencies.js";

type Payload = {
  graph: DependencyGraph;
  analysis: ReturnType<typeof analyzeDependencies>;
};
const { graph, analysis } = JSON.parse(
  document.getElementById("graph-data")?.textContent ?? "{}",
) as Payload;
const element = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing viewer element ${id}.`);
  return value as T;
};
const canvas = element("canvas");
const groups = new Map<
  string,
  { name: string; color: string; nodes: DependencyNode[] }
>();
const nodeMap = new Map(graph.nodes.map((node) => [node.id, node]));
const cyIds = new Map(
  graph.nodes.map((node, index) => [node.id, `artifact:${index}`]),
);
const cycleIds = new Set(analysis.cycles.flat());
const solutionRoots = graph.roots.filter(
  (id) => nodeMap.get(id)?.kind === "solution",
);
const primaryRoots = new Set(
  solutionRoots.length ? solutionRoots : graph.roots,
);
const expanded = new Set<string>();
const enabled = new Set<string>();
const relations = new Set([
  "requires",
  "contains",
  "uses-connector",
  "binds-to",
]);
let focusId: string | null = null;
let selectedId: string | null = null;
let cy: Core;

function category(node: DependencyNode): [string, string, string] {
  if (node.kind === "solution") return ["solutions", "Solutions", "#6366f1"];
  if (node.kind === "connection-reference")
    return ["references", "Connection references", "#0d9488"];
  if (node.kind === "connection")
    return ["connections", "Connections", "#65a30d"];
  if (node.kind === "connector" || node.kind === "connector-api")
    return ["connectors", "Connectors", "#0891b2"];
  switch (node.componentType) {
    case 1:
      return ["tables", "Tables", "#7c3aed"];
    case 2:
      return ["columns", "Columns", "#a78bfa"];
    case 10:
      return ["relationships", "Relationships", "#64748b"];
    case 29:
      return ["flows", "Flows / processes", "#db2777"];
    case 80:
      return ["model-apps", "Model-driven apps", "#c026d3"];
    case 300:
      return ["canvas-apps", "Canvas apps", "#e11d48"];
    case 20:
      return ["roles", "Roles", "#ea580c"];
    case 9:
      return ["choices", "Choices", "#a16207"];
    case 380:
    case 381:
      return ["variables", "Environment variables", "#16a34a"];
    case 60:
    case 24:
    case 26:
    case 62:
    case 61:
      return ["interface", "Forms, views & resources", "#0e7490"];
    default:
      return ["other", "Other components", "#78716c"];
  }
}
for (const node of graph.nodes) {
  const [key, name, color] = category(node);
  const group = groups.get(key) ?? { name, color, nodes: [] };
  group.nodes.push(node);
  groups.set(key, group);
  enabled.add(key);
}
function button(
  label: string,
  action: () => void,
  className = "",
): HTMLButtonElement {
  const value = document.createElement("button");
  value.type = "button";
  value.textContent = label;
  value.className = className;
  value.addEventListener("click", action);
  return value;
}
function text(tag: string, value: string, className = ""): HTMLElement {
  const result = document.createElement(tag);
  result.textContent = value;
  result.className = className;
  return result;
}
function neighbors(id: string): Set<string> {
  const found = new Set([id]);
  for (const edge of graph.edges)
    if (relations.has(edge.kind) && edge.kind !== "contains") {
      if (edge.from === id) found.add(edge.to);
      if (edge.to === id) found.add(edge.from);
    }
  return found;
}
function updateFilters() {
  element("filters").replaceChildren();
  for (const [key, group] of groups) {
    const label = document.createElement("label");
    label.className = "filter";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = enabled.has(key);
    input.setAttribute("aria-label", group.name);
    input.addEventListener("change", () => {
      if (input.checked) enabled.add(key);
      else enabled.delete(key);
      rebuild();
    });
    const dot = text("i", "", "dot");
    dot.style.background = group.color;
    label.append(
      input,
      dot,
      text("span", group.name),
      text("small", String(group.nodes.length)),
    );
    element("filters").append(label);
  }
}
function boxed(key: string): boolean {
  return expanded.has(key) || focusId !== null;
}
function visibleKey(node: DependencyNode): string {
  const key = category(node)[0];
  return primaryRoots.has(node.id) ||
    boxed(key) ||
    groups.get(key)?.nodes.length === 1
    ? (cyIds.get(node.id) as string)
    : `group:${key}`;
}
function canvasLabel(node: DependencyNode, inBox: boolean): string {
  const short = `#${node.objectId.slice(0, 8)}`;
  const label =
    node.labelStatus === "unresolved" && node.componentType !== null
      ? inBox
        ? short
        : `Component ${node.componentType} ${short}`
      : node.label.length > 52
        ? `${node.label.slice(0, 51)}…`
        : node.label;
  return label.replace(/([/._-])/g, "$1\u200b");
}
function rebuild() {
  document.body.dataset.ready = "false";
  const scope = focusId === null ? null : neighbors(focusId);
  const shown = graph.nodes.filter(
    (node) =>
      enabled.has(category(node)[0]) && (scope === null || scope.has(node.id)),
  );
  const perType = new Map<string, number>();
  for (const node of shown) {
    const key = category(node)[0];
    perType.set(key, (perType.get(key) ?? 0) + 1);
  }
  const inBox = (node: DependencyNode) => {
    const key = category(node)[0];
    return boxed(key) && (perType.get(key) ?? 0) > 1;
  };
  // An artifact inside a type box draws its relations at box level.
  const endpoint = (node: DependencyNode) =>
    inBox(node) ? `box:${category(node)[0]}` : visibleKey(node);
  const display = new Map<string, ElementDefinition>();
  const counts = new Map<string, number>();
  for (const node of shown) {
    const id = visibleKey(node);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  for (const node of shown) {
    const [key, name, color] = category(node);
    if (inBox(node) && !display.has(`box:${key}`))
      display.set(`box:${key}`, {
        data: {
          id: `box:${key}`,
          label: `${name} · ${perType.get(key)}`,
          color,
          unit: key,
          graphId: null,
          groupKey: key,
        },
        classes: "box",
      });
    const id = visibleKey(node);
    if (display.has(id)) continue;
    const count = counts.get(id) ?? 1;
    const group = id.startsWith("group:");
    display.set(id, {
      data: {
        id,
        label: group
          ? `${name}\n${count} ${count === 1 ? "artifact" : "artifacts"}`
          : canvasLabel(node, inBox(node)),
        sort: group ? "" : node.label,
        color,
        unit: key,
        ...(inBox(node) ? { parent: `box:${key}` } : {}),
        graphId: group ? null : node.id,
        groupKey: group ? key : null,
      },
      classes: [
        group ? "group" : "artifact",
        primaryRoots.has(node.id) ? "primary" : "",
        !group && cycleIds.has(node.id) ? "cycle" : "",
      ].join(" "),
    });
  }
  const aggregates = new Map<
    string,
    { source: string; target: string; kind: string; count: number }
  >();
  for (const edge of graph.edges) {
    if (!relations.has(edge.kind)) continue;
    const from = nodeMap.get(edge.from);
    const to = nodeMap.get(edge.to);
    if (!from || !to) continue;
    const source = endpoint(from);
    const target = endpoint(to);
    if (source === target || !display.has(source) || !display.has(target))
      continue;
    const key = JSON.stringify([source, target, edge.kind]);
    const value = aggregates.get(key) ?? {
      source,
      target,
      kind: edge.kind,
      count: 0,
    };
    value.count += 1;
    aggregates.set(key, value);
  }
  const entries = [...display.values()];
  let edgeIndex = 0;
  for (const edge of aggregates.values())
    entries.push({
      data: {
        id: `relation:${edgeIndex++}`,
        source: edge.source,
        target: edge.target,
        kind: edge.kind,
        label: `${edge.count > 1 ? `${edge.count} × ` : ""}${edge.kind}`,
        weight: Math.min(4, 0.75 + Math.log2(edge.count + 1) / 2),
      },
      classes: edgeClass(edge.kind),
    });
  cy.elements().remove();
  cy.add(entries);
  arrange();
  const leaves = cy.nodes().not(".box").length;
  element("view-summary").textContent =
    `${focusId ? "Neighborhood" : expanded.size ? "Expanded view" : "Grouped overview"} · ${shown.length} of ${graph.nodes.length} artifacts · ${leaves} visible nodes`;
  element("overview").setAttribute(
    "aria-pressed",
    String(focusId === null && expanded.size === 0),
  );
  element("expand-all").setAttribute(
    "aria-pressed",
    String(focusId === null && expanded.size === groups.size),
  );
  if (selectedId && shown.some((node) => node.id === selectedId))
    highlight(selectedId);
  else {
    selectedId = null;
    showDetails(false);
  }
}
function edgeClass(kind: string): string {
  return kind === "contains"
    ? "membership"
    : kind === "requires"
      ? "dependency"
      : "binding";
}
const cell = { width: 190, height: 70 };
const gap = { layer: 160, unit: 88, title: 44, padding: 16 };
// One unit per artifact type: a box of its artifacts, or its collapsed
// group and root cards. Units are layered left to right, consumers before
// their requirements, so every view keeps the same map.
function arrange() {
  const units = new Map<string, NodeSingular[]>();
  cy.nodes()
    .not(".box")
    .forEach((node) => {
      const key = String(node.data("unit"));
      units.set(key, [...(units.get(key) ?? []), node]);
    });
  const keys = [...units.keys()];
  const outgoing = new Map(keys.map((key) => [key, new Set<string>()]));
  const incoming = new Map(keys.map((key) => [key, new Set<string>()]));
  cy.edges()
    .not(".membership")
    .forEach((edge) => {
      const source = String(edge.source().data("unit"));
      const target = String(edge.target().data("unit"));
      if (source === target) return;
      outgoing.get(source)?.add(target);
      incoming.get(target)?.add(source);
    });
  const layer = new Map<string, number>();
  for (const seed of [
    ...keys.filter((key) => incoming.get(key)?.size === 0),
    ...keys,
  ]) {
    if (layer.has(seed)) continue;
    layer.set(seed, 0);
    const queue = [seed];
    for (let index = 0; index < queue.length; index++) {
      const key = queue[index] as string;
      for (const next of outgoing.get(key) ?? [])
        if (!layer.has(next)) {
          layer.set(next, (layer.get(key) ?? 0) + 1);
          queue.push(next);
        }
    }
  }
  const layers: string[][] = [];
  for (const key of keys) {
    const depth = layer.get(key) ?? 0;
    const members = layers[depth] ?? [];
    members.push(key);
    layers[depth] = members;
  }
  const order = new Map<string, number>();
  layers.forEach((members, depth) => {
    const barycenter = (key: string) => {
      const placed = [...(incoming.get(key) ?? [])].filter(
        (other) => (layer.get(other) ?? 0) < depth,
      );
      return placed.length
        ? placed.reduce((sum, other) => sum + (order.get(other) ?? 0), 0) /
            placed.length
        : -1;
    };
    members.sort((a, b) => barycenter(a) - barycenter(b) || a.localeCompare(b));
    members.forEach((key, index) => {
      order.set(key, index / Math.max(1, members.length));
    });
  });
  const size = (key: string) => {
    const nodes = units.get(key) ?? [];
    if (!nodes[0]?.isChild()) return { columns: 1, rows: nodes.length };
    const columns = Math.max(
      1,
      Math.min(
        nodes.length,
        Math.ceil(Math.sqrt((nodes.length * 1.6 * cell.height) / cell.width)),
      ),
    );
    return { columns, rows: Math.ceil(nodes.length / columns) };
  };
  const extent = (key: string) => {
    const { columns, rows } = size(key);
    const box = units.get(key)?.[0]?.isChild() ?? false;
    const frame = box ? gap.padding * 2 : 0;
    return {
      width: columns * cell.width + frame,
      height:
        rows * (cell.height + (box ? 0 : 14)) + frame + (box ? gap.title : 0),
    };
  };
  let x = 0;
  for (const members of layers) {
    const width = Math.max(...members.map((key) => extent(key).width));
    const total =
      members.reduce((sum, key) => sum + extent(key).height, 0) +
      (members.length - 1) * gap.unit;
    let y = -total / 2;
    for (const key of members) {
      const nodes = [...(units.get(key) ?? [])].sort(
        (a, b) =>
          Number(b.hasClass("primary")) - Number(a.hasClass("primary")) ||
          String(a.data("sort")).localeCompare(String(b.data("sort"))),
      );
      const { columns } = size(key);
      const { width: unitWidth, height } = extent(key);
      const box = nodes[0]?.isChild() ?? false;
      const left = x + (width - unitWidth) / 2 + (box ? gap.padding : 0);
      const top = y + (box ? gap.title + gap.padding : 0);
      const rowHeight = cell.height + (box ? 0 : 14);
      nodes.forEach((node, index) => {
        node.position({
          x: left + (index % columns) * cell.width + cell.width / 2,
          y: top + Math.floor(index / columns) * rowHeight + rowHeight / 2,
        });
      });
      y += height + gap.unit;
    }
    x += width + gap.layer;
  }
  fitView();
  drawMinimap();
  document.body.dataset.ready = "true";
}
function clearHighlight() {
  cy.remove(".detail");
  cy.elements().removeClass(
    "faded emphasized consumer requirement selected-node",
  );
}
function highlight(id: string) {
  clearHighlight();
  const node = nodeMap.get(id);
  if (!node) return;
  const visible = cy.getElementById(visibleKey(node));
  cy.elements().not(".box").addClass("faded");
  visible.removeClass("faded").addClass("selected-node");
  const details = new Map<
    string,
    { source: string; target: string; kind: string; count: number }
  >();
  for (const edge of graph.edges) {
    if (!relations.has(edge.kind) || edge.kind === "contains") continue;
    const required = edge.from === id;
    const dependent = edge.to === id;
    if (!required && !dependent) continue;
    const neighbor = nodeMap.get(required ? edge.to : edge.from);
    if (!neighbor) continue;
    const other = cy.getElementById(visibleKey(neighbor));
    if (other.empty() || other.same(visible)) continue;
    other.removeClass("faded").addClass(required ? "requirement" : "consumer");
    const source = required ? visible.id() : other.id();
    const target = required ? other.id() : visible.id();
    const key = JSON.stringify([source, target, edge.kind]);
    const value = details.get(key) ?? {
      source,
      target,
      kind: edge.kind,
      count: 0,
    };
    value.count += 1;
    details.set(key, value);
  }
  cy.add(
    [...details.values()].map((edge, index) => ({
      data: {
        id: `detail:${index}`,
        source: edge.source,
        target: edge.target,
        label: edge.count > 1 ? `${edge.count} ×` : "",
        weight: 1.25,
      },
      classes: `detail emphasized ${edgeClass(edge.kind)}`,
    })),
  );
}
function navigate(id: string) {
  const node = nodeMap.get(id);
  if (!node) return;
  const key = category(node)[0];
  enabled.add(key);
  expanded.add(key);
  if (focusId !== null) focusId = id;
  selectedId = id;
  element<HTMLInputElement>("search").value = "";
  element("search-results").replaceChildren();
  updateFilters();
  rebuild();
  select(id);
  const target = cy.getElementById(cyIds.get(id) as string);
  cy.zoom(1);
  cy.center(target);
  cy.panBy({ x: -element("details-panel").offsetWidth / 2, y: 0 });
  drawMinimap();
}
function showDetails(open: boolean) {
  element("details-panel").hidden = !open;
}
function eyebrow(label: string, color?: string): HTMLElement {
  const value = text("p", "", "eyebrow");
  if (color) {
    const dot = text("i", "", "dot");
    dot.style.background = color;
    value.append(dot);
  }
  value.append(label);
  return value;
}
function select(id: string) {
  selectedId = id;
  const node = nodeMap.get(id);
  if (!node) return;
  highlight(id);
  const [, name, color] = category(node);
  const inspector = element("inspector");
  inspector.replaceChildren(eyebrow(name, color), text("h2", node.label));
  showDetails(true);
  if (graph.frontier.includes(id))
    inspector.append(
      text(
        "p",
        "Unexplored frontier — more dependencies may exist.",
        "callout",
      ),
    );
  if (cycleIds.has(id))
    inspector.append(
      text("p", "Part of an observed dependency cycle.", "callout"),
    );
  inspector.append(
    button(
      "Focus neighbors",
      () => {
        focusId = id;
        rebuild();
        select(id);
      },
      "primary-button",
    ),
  );
  const details = document.createElement("dl");
  for (const [label, value] of [
    ["Object ID", node.objectId],
    [
      "Component type",
      node.componentType === null ? node.kind : String(node.componentType),
    ],
    ["Logical name", node.logicalName ?? "Unresolved"],
    ["Label evidence", node.labelStatus],
  ] as const)
    details.append(text("dt", label), text("dd", value));
  inspector.append(details);
  const sections = [
    [
      "Requirements",
      graph.edges.filter(
        (edge) => edge.from === id && edge.kind === "requires",
      ),
    ],
    [
      "Consumers",
      graph.edges.filter((edge) => edge.to === id && edge.kind === "requires"),
    ],
    [
      "Connection bindings",
      graph.edges.filter(
        (edge) =>
          (edge.from === id || edge.to === id) &&
          (edge.kind === "binds-to" || edge.kind === "uses-connector"),
      ),
    ],
    [
      "Solution membership",
      graph.edges.filter(
        (edge) =>
          (edge.from === id || edge.to === id) && edge.kind === "contains",
      ),
    ],
  ] as const;
  for (const [name, edges] of sections) {
    if (!edges.length) continue;
    const heading = text("h3", name);
    heading.append(text("span", String(edges.length)));
    inspector.append(heading);
    for (const edge of edges) {
      const other = nodeMap.get(edge.from === id ? edge.to : edge.from);
      if (!other) continue;
      const row = button(other.label, () => navigate(other.id), "relation-row");
      row.append(
        text(
          "small",
          `${edge.kind} · ${edge.evidence}${edge.dependencyType === null ? "" : ` · type ${edge.dependencyType}`}`,
        ),
      );
      inspector.append(row);
    }
  }
  if (sections.every(([, edges]) => !edges.length))
    inspector.append(text("p", "No captured relations.", "muted"));
  const issues = graph.issues.filter((issue) => issue.nodeId === id);
  if (issues.length) {
    inspector.append(text("h3", "Collection issues"));
    for (const issue of issues)
      inspector.append(
        text("p", `${issue.operation}: ${issue.code}`, "warning"),
      );
  }
}
function showGroup(key: string) {
  const group = groups.get(key);
  if (!group) return;
  clearHighlight();
  selectedId = null;
  const inspector = element("inspector");
  showDetails(true);
  inspector.replaceChildren(
    eyebrow("Artifact group", group.color),
    text("h2", group.name),
    text(
      "p",
      `${group.nodes.length} captured ${group.nodes.length === 1 ? "artifact" : "artifacts"}. Expanding never queries the environment.`,
      "muted",
    ),
    expanded.has(key)
      ? button(
          "Collapse group",
          () => {
            expanded.delete(key);
            rebuild();
          },
          "primary-button",
        )
      : button(
          `Expand group (${group.nodes.length})`,
          () => {
            expanded.add(key);
            rebuild();
          },
          "primary-button",
        ),
    text("h3", "Artifacts"),
  );
  for (const node of [...group.nodes].sort((a, b) =>
    a.label.localeCompare(b.label),
  )) {
    const row = button(node.label, () => navigate(node.id), "relation-row");
    row.append(
      text("small", `${node.componentType ?? node.kind} · ${node.objectId}`),
    );
    inspector.append(row);
  }
}
function summary() {
  const inspector = element("inspector");
  const stats = text("div", "", "stats");
  for (const [value, label] of [
    [graph.nodes.length, "artifacts"],
    [graph.edges.length, "relations"],
    [analysis.cycles.length, "cycles"],
  ] as const) {
    const tile = document.createElement("div");
    tile.append(text("strong", String(value)), text("span", label));
    stats.append(tile);
  }
  showDetails(true);
  inspector.replaceChildren(
    eyebrow("Captured snapshot"),
    text("h2", graph.environment.name),
    text("p", graph.environment.url, "muted"),
    stats,
    text(
      "p",
      `${graph.frontier.length} frontier nodes · ${graph.issues.length} collection issues`,
      "muted",
    ),
  );
  if (!graph.closureComplete)
    inspector.append(
      text(
        "p",
        "Coverage is incomplete. Expanding this canvas cannot recover artifacts or relationships that were not collected.",
        "callout",
      ),
    );
  if (graph.issues.length) {
    inspector.append(text("h3", "Collection issue codes"));
    const counts = new Map<string, number>();
    for (const issue of graph.issues)
      counts.set(issue.code, (counts.get(issue.code) ?? 0) + 1);
    for (const [code, count] of counts)
      inspector.append(text("p", `${code} · ${count}`, "warning"));
  }
  const coverage = document.createElement("details");
  coverage.append(text("summary", "Coverage notes"));
  for (const limitation of graph.limitations)
    coverage.append(text("p", limitation));
  inspector.append(coverage);
}
function overview() {
  expanded.clear();
  enabled.clear();
  for (const key of groups.keys()) enabled.add(key);
  focusId = null;
  selectedId = null;
  element<HTMLInputElement>("search").value = "";
  element("search-results").replaceChildren();
  updateFilters();
  rebuild();
}

let miniBox = { x1: 0, y1: 0, scale: 1 };
let miniFrame = 0;
function drawMinimap() {
  const minimap = document.getElementById(
    "minimap",
  ) as unknown as SVGSVGElement;
  minimap.replaceChildren();
  const bounds = cy.nodes().empty()
    ? { x1: 0, y1: 0, w: 100, h: 100 }
    : cy.nodes().boundingBox({ includeLabels: false, includeOverlays: false });
  const width = Math.max(100, bounds.w);
  const height = Math.max(100, bounds.h);
  const scale = Math.min(176 / width, 96 / height);
  miniBox = {
    x1: bounds.x1 - (200 / scale - width) / 2,
    y1: bounds.y1 - (120 / scale - height) / 2,
    scale,
  };
  cy.nodes(".box").forEach((box) => {
    const frame = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "rect",
    );
    const area = box.boundingBox({ includeLabels: false });
    frame.setAttribute("x", String((area.x1 - miniBox.x1) * scale));
    frame.setAttribute("y", String((area.y1 - miniBox.y1) * scale));
    frame.setAttribute("width", String(area.w * scale));
    frame.setAttribute("height", String(area.h * scale));
    frame.setAttribute("rx", "2");
    frame.setAttribute("fill", String(box.data("color")));
    frame.setAttribute("fill-opacity", "0.12");
    minimap.append(frame);
  });
  cy.nodes()
    .not(".box")
    .forEach((node) => {
      const dot = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "circle",
      );
      const position = node.position();
      dot.setAttribute("cx", String((position.x - miniBox.x1) * scale));
      dot.setAttribute("cy", String((position.y - miniBox.y1) * scale));
      dot.setAttribute(
        "r",
        node.hasClass("primary") || node.hasClass("group") ? "4" : "2",
      );
      dot.setAttribute("fill", String(node.data("color")));
      if (node.hasClass("group")) dot.dataset.group = "true";
      minimap.append(dot);
    });
  const view = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  view.id = "mini-viewport";
  minimap.append(view);
  updateViewport();
}
// Box titles keep a constant on-screen size, like frame names.
function scaleTitles() {
  cy.nodes(".box").style("font-size", Math.min(32, 14 / cy.zoom()));
}
function updateViewport() {
  element("zoom-label").textContent = `${Math.round(cy.zoom() * 100)}%`;
  const view = document.getElementById("mini-viewport");
  if (!view) return;
  const extent = cy.extent();
  view.setAttribute("x", String((extent.x1 - miniBox.x1) * miniBox.scale));
  view.setAttribute("y", String((extent.y1 - miniBox.y1) * miniBox.scale));
  view.setAttribute("width", String(extent.w * miniBox.scale));
  view.setAttribute("height", String(extent.h * miniBox.scale));
}
// Fits the visible nodes into the canvas area the details panel leaves free.
function fitView() {
  const panel = element("details-panel");
  const free = cy.width() - (panel.hidden ? 0 : panel.offsetWidth + 12);
  cy.fit(undefined, 72);
  if (cy.zoom() > 1.25) {
    cy.zoom(1.25);
    cy.center();
  }
  if (free < cy.width())
    cy.zoom({
      level: (cy.zoom() * free) / cy.width(),
      renderedPosition: { x: 0, y: cy.height() / 2 },
    });
  scaleTitles();
}
function zoom(factor: number) {
  cy.zoom({
    level: Math.max(cy.minZoom(), Math.min(cy.maxZoom(), cy.zoom() * factor)),
    renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
  });
}

function stylesheet(): StylesheetJson {
  const css = getComputedStyle(document.documentElement);
  const token = (name: string) => css.getPropertyValue(`--${name}`).trim();
  return [
    {
      selector: "node",
      style: {
        "background-color": "data(color)",
        "background-opacity": 0.08,
        "border-color": "data(color)",
        "border-width": 1.5,
        "border-opacity": 0.75,
        shape: "round-rectangle",
        "corner-radius": "10",
        width: 172,
        height: 58,
        label: "data(label)",
        color: token("ink"),
        "font-family": "system-ui, -apple-system, Segoe UI, sans-serif",
        "font-size": 12,
        "text-wrap": "wrap",
        "text-max-width": "148px",
        "line-height": 1.35,
        "text-valign": "center",
        "text-halign": "center",
        "overlay-opacity": 0,
        "min-zoomed-font-size": 6,
      },
    },
    {
      selector: "node.group",
      style: {
        width: 176,
        height: 64,
        "font-size": 13,
        "font-weight": 500,
        "line-height": 1.5,
      },
    },
    {
      selector: "node.box",
      style: {
        shape: "round-rectangle",
        "corner-radius": "14",
        "background-opacity": 0.05,
        "border-width": 1,
        "border-opacity": 0.45,
        padding: "16px",
        label: "data(label)",
        "text-valign": "top",
        "text-halign": "center",
        "text-margin-y": -6,
        "text-wrap": "none",
        "font-size": 14,
        "font-weight": 600,
        color: "data(color)",
        "min-zoomed-font-size": 0,
      },
    },
    {
      selector: "node.primary",
      style: {
        "background-opacity": 0.16,
        "border-width": 2.5,
        "border-opacity": 1,
        "font-weight": 600,
      },
    },
    {
      selector: "node.cycle",
      style: { "border-style": "double", "border-width": 4.5 },
    },
    {
      selector: "edge",
      style: {
        width: "data(weight)",
        "line-color": token("edge"),
        "target-arrow-color": token("edge"),
        "target-arrow-shape": "triangle",
        "arrow-scale": 0.8,
        "curve-style": "bezier",
        opacity: 0.9,
        "overlay-opacity": 0,
        "font-size": 10,
        color: token("muted"),
        "text-background-color": token("bg"),
        "text-background-opacity": 1,
        "text-background-padding": "3px",
        "text-background-shape": "roundrectangle",
      },
    },
    {
      selector: "edge.membership",
      style: {
        "line-style": "dashed",
        "line-dash-pattern": [4, 4],
        "line-color": token("edge-soft"),
        "target-arrow-color": token("edge-soft"),
      },
    },
    {
      selector: "edge.binding",
      style: {
        "line-style": "dashed",
        "line-dash-pattern": [4, 4],
        "line-color": token("binding"),
        "target-arrow-color": token("binding"),
      },
    },
    { selector: ".faded", style: { opacity: 0.12 } },
    {
      selector: "node.requirement",
      style: {
        "border-color": token("req"),
        "border-width": 2,
        "border-opacity": 1,
      },
    },
    {
      selector: "node.consumer",
      style: {
        "border-color": token("amber"),
        "border-width": 2,
        "border-opacity": 1,
      },
    },
    {
      selector: "node.selected-node",
      style: {
        "border-color": token("ink"),
        "border-width": 2.5,
        "border-opacity": 1,
        "background-opacity": 0.2,
      },
    },
    {
      selector: "edge.emphasized",
      style: { opacity: 1, label: "data(label)", "z-index": 10 },
    },
  ];
}

function boot() {
  element("coverage-status").textContent = graph.closureComplete
    ? "Declared traversal completed"
    : "Incomplete collection";
  element("coverage-status").classList.toggle(
    "warning",
    !graph.closureComplete,
  );
  cy = cytoscape({
    container: canvas,
    elements: [],
    minZoom: 0.06,
    maxZoom: 3.5,
    boxSelectionEnabled: false,
    style: stylesheet(),
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () =>
    cy.style(stylesheet()),
  );
  cy.on("tap", "node", (event) => {
    const node = event.target as NodeSingular;
    const key = node.data("groupKey") as string | null;
    if (key) showGroup(key);
    else select(String(node.data("graphId")));
  });
  cy.on("dbltap", "node.group", (event) => {
    expanded.add(String(event.target.data("groupKey")));
    rebuild();
  });
  cy.on("tap", (event) => {
    if (event.target === cy) {
      selectedId = null;
      clearHighlight();
      showDetails(false);
    }
  });
  cy.on("pan zoom", updateViewport);
  cy.on("zoom", scaleTitles);
  cy.on("position", () => {
    if (!miniFrame)
      miniFrame = requestAnimationFrame(() => {
        miniFrame = 0;
        drawMinimap();
      });
  });
  element("fit").addEventListener("click", fitView);
  element("overview").addEventListener("click", overview);
  element("arrange").addEventListener("click", arrange);
  element("expand-all").addEventListener("click", () => {
    for (const key of groups.keys()) expanded.add(key);
    focusId = null;
    rebuild();
  });
  element("root").addEventListener("click", () => {
    const id = [...primaryRoots][0];
    if (id) {
      focusId = null;
      navigate(id);
    }
  });
  element("zoom-in").addEventListener("click", () => zoom(1.25));
  element("zoom-label").addEventListener("click", fitView);
  element("coverage-status").addEventListener("click", summary);
  element("details-close").addEventListener("click", () => showDetails(false));
  const filtersToggle = element("filters-toggle");
  filtersToggle.addEventListener("click", () => {
    const panel = element("filters-panel");
    panel.hidden = !panel.hidden;
    filtersToggle.setAttribute("aria-pressed", String(!panel.hidden));
  });
  element("zoom-out").addEventListener("click", () => zoom(0.8));
  canvas.addEventListener("keydown", (event) => {
    const delta = {
      ArrowLeft: { x: 70, y: 0 },
      ArrowRight: { x: -70, y: 0 },
      ArrowUp: { x: 0, y: 70 },
      ArrowDown: { x: 0, y: -70 },
    }[event.key];
    if (delta) {
      event.preventDefault();
      cy.panBy(delta);
    }
    if (event.key === "+" || event.key === "=") zoom(1.25);
    if (event.key === "-") zoom(0.8);
    if (event.key === "0") fitView();
  });
  for (const kind of relations) {
    const input = element<HTMLInputElement>(`edge-${kind}`);
    input.addEventListener("change", () => {
      if (input.checked) relations.add(kind);
      else relations.delete(kind);
      rebuild();
    });
  }
  const search = element<HTMLInputElement>("search");
  search.addEventListener("input", () => {
    const query = search.value.trim().toLowerCase();
    const results = element("search-results");
    results.replaceChildren();
    if (!query) return;
    const found = graph.nodes
      .filter((node) =>
        [
          node.label,
          node.logicalName,
          node.objectId,
          String(node.componentType ?? node.kind),
        ].some((value) => value?.toLowerCase().includes(query)),
      )
      .slice(0, 40);
    for (const node of found) {
      const row = button("", () => navigate(node.id), "search-result");
      const dot = text("i", "", "dot");
      dot.style.background = category(node)[2];
      row.append(
        dot,
        text("span", node.label),
        text("small", `${category(node)[1]} · ${node.objectId}`),
      );
      results.append(row);
    }
    if (!found.length)
      results.append(
        text("p", "No artifact found in this captured snapshot.", "muted"),
      );
  });
  search.addEventListener("keydown", (event) => {
    if (event.key === "Enter")
      element("search-results")
        .querySelector<HTMLButtonElement>("button")
        ?.click();
    if (event.key === "Escape") {
      search.value = "";
      element("search-results").replaceChildren();
      search.blur();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "/" && !(event.target instanceof HTMLInputElement)) {
      event.preventDefault();
      search.focus();
    }
    if (event.key === "Escape" && !(event.target instanceof HTMLInputElement)) {
      showDetails(false);
      element("filters-panel").hidden = true;
      filtersToggle.setAttribute("aria-pressed", "false");
    }
  });
  let draggingMini = false;
  const minimap = document.getElementById(
    "minimap",
  ) as unknown as SVGSVGElement;
  const moveMini = (event: PointerEvent) => {
    if (!draggingMini) return;
    const box = minimap.getBoundingClientRect();
    const x =
      miniBox.x1 +
      ((event.clientX - box.left) * (200 / box.width)) / miniBox.scale;
    const y =
      miniBox.y1 +
      ((event.clientY - box.top) * (120 / box.height)) / miniBox.scale;
    cy.pan({
      x: cy.width() / 2 - x * cy.zoom(),
      y: cy.height() / 2 - y * cy.zoom(),
    });
  };
  minimap.addEventListener("pointerdown", (event) => {
    draggingMini = true;
    minimap.setPointerCapture(event.pointerId);
    moveMini(event);
  });
  minimap.addEventListener("pointermove", moveMini);
  minimap.addEventListener("pointerup", () => {
    draggingMini = false;
  });
  minimap.addEventListener("pointercancel", () => {
    draggingMini = false;
  });
  new ResizeObserver(() => {
    cy.resize();
    drawMinimap();
  }).observe(canvas);
  updateFilters();
  rebuild();
}
try {
  boot();
} catch (error) {
  element("view-summary").textContent =
    "Canvas could not initialize. JSON and Mermaid exports remain available.";
  element("inspector").textContent =
    error instanceof Error ? error.message : "Viewer initialization failed.";
  document.body.dataset.ready = "error";
}
