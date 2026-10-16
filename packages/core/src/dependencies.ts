import { render } from "pele";
import { dependencyViewerHtml } from "./dependency-viewer-html.js";
import type { SchemaEnvironment } from "./plan.js";

export interface DependencyNode {
  readonly id: string;
  readonly kind:
    | "component"
    | "connection-reference"
    | "connector"
    | "connector-api"
    | "connection"
    | "solution";
  readonly objectId: string;
  readonly componentType: number | null;
  readonly label: string;
  readonly logicalName: string | null;
  readonly labelStatus: "resolved" | "unresolved";
  readonly distance: number;
}

export interface DependencyEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: "requires" | "contains" | "uses-connector" | "binds-to";
  readonly evidence:
    | "dataverse-dependency"
    | "solution-membership"
    | "connection-reference-metadata";
  readonly dependencyType: number | null;
}

export interface DependencyGraph {
  readonly graphVersion: 1;
  readonly environment: SchemaEnvironment;
  readonly direction: "required" | "dependent" | "both";
  readonly roots: readonly string[];
  readonly nodes: readonly DependencyNode[];
  readonly edges: readonly DependencyEdge[];
  readonly complete: boolean;
  readonly closureComplete: boolean;
  readonly frontier: readonly string[];
  readonly queries: number;
  readonly issues: readonly {
    readonly nodeId: string | null;
    readonly operation: string;
    readonly code: string;
  }[];
  readonly limitations: readonly string[];
}

export function analyzeDependencies(graph: DependencyGraph) {
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const node of graph.nodes) {
    incoming.set(node.id, []);
    outgoing.set(node.id, []);
  }
  for (const edge of graph.edges) {
    if (edge.kind === "contains") continue;
    incoming.get(edge.to)?.push(edge.from);
    outgoing.get(edge.from)?.push(edge.to);
  }
  const paths = new Map(graph.roots.map((root) => [root, [root]]));
  const queue = [...graph.roots];
  for (let index = 0; index < queue.length; index += 1) {
    const id = queue[index] as string;
    for (const dependent of [...new Set(incoming.get(id))].sort()) {
      if (paths.has(dependent)) continue;
      paths.set(dependent, [...(paths.get(id) ?? []), dependent]);
      queue.push(dependent);
    }
  }
  const affected = [...paths]
    .filter(([id]) => !graph.roots.includes(id))
    .map(([nodeId, path]) => ({ nodeId, distance: path.length - 1, path }))
    .sort(
      (a, b) => a.distance - b.distance || a.nodeId.localeCompare(b.nodeId),
    );
  const indices = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const active = new Set<string>();
  const cycles: string[][] = [];
  function visit(id: string) {
    indices.set(id, indices.size);
    low.set(id, indices.get(id) as number);
    stack.push(id);
    active.add(id);
    for (const next of [...new Set(outgoing.get(id))].sort()) {
      if (!indices.has(next)) {
        visit(next);
        low.set(id, Math.min(low.get(id) as number, low.get(next) as number));
      } else if (active.has(next))
        low.set(
          id,
          Math.min(low.get(id) as number, indices.get(next) as number),
        );
    }
    if (low.get(id) !== indices.get(id)) return;
    const group: string[] = [];
    let member: string;
    do {
      member = stack.pop() as string;
      active.delete(member);
      group.push(member);
    } while (member !== id);
    if (group.length > 1 || outgoing.get(id)?.includes(id))
      cycles.push(group.sort());
  }
  for (const node of graph.nodes) if (!indices.has(node.id)) visit(node.id);
  return {
    affected,
    cycles: cycles.sort((a, b) => (a[0] ?? "").localeCompare(b[0] ?? "")),
    complete: graph.closureComplete,
    interpretation:
      "Potential impact through observed dependency paths, not proof of runtime failure or permission to delete.",
  };
}

export function dependencyMermaid(graph: DependencyGraph): string {
  const ids = new Map(graph.nodes.map((node, index) => [node.id, `n${index}`]));
  const lines = [
    "flowchart LR",
    `  %% Environment: ${mermaidText(graph.environment.name)}; ${mermaidText(graph.environment.url)}; organization: ${mermaidText(graph.environment.organizationId)}`,
    `  %% Observed Dataverse graph; closure complete: ${graph.closureComplete}; frontier: ${graph.frontier.length}; issues: ${graph.issues.length}`,
  ];
  for (const node of graph.nodes)
    lines.push(
      `  ${ids.get(node.id)}["${mermaidText(`${node.label} (${node.componentType ?? node.kind})`)}"]`,
    );
  for (const edge of graph.edges)
    lines.push(
      `  ${ids.get(edge.from)} ${edge.kind === "requires" ? "-->" : "-.->"}|${edge.kind}${edge.dependencyType === null ? "" : `:${edge.dependencyType}`}| ${ids.get(edge.to)}`,
    );
  for (const root of graph.roots)
    lines.push(`  style ${ids.get(root)} stroke:#2563eb,stroke-width:3px`);
  return `${lines.join("\n")}\n`;
}

// Light and dark palettes of the HTML canvas, read by Pele's CSS variables.
const svgTheme =
  "<style>.pele{--pele-bg:#fff;--pele-fg:#1b1b1f;--pele-muted:#6b6b76;--pele-line:#9a9aa6;--pele-surface:#fff;--pele-surface-alt:#f1f0ff;--pele-border:#d6d6de;--pele-accent:#6965db;--pele-radius:8px}@media(prefers-color-scheme:dark){.pele{--pele-bg:#121212;--pele-fg:#e3e3e8;--pele-muted:#a3a3ad;--pele-line:#74747f;--pele-surface:#232329;--pele-surface-alt:#2e2d39;--pele-border:#3a3a42;--pele-accent:#a8a5ff}}</style>";

export function dependencySvg(graph: DependencyGraph): string {
  const title = `Observed dependency graph · ${graph.closureComplete ? "complete" : "incomplete"} · frontier ${graph.frontier.length} · issues ${graph.issues.length}`;
  // Graph budgets bound the source; Pele's smaller default limits would reject valid graphs.
  const { svg, width, height } = render(
    `---\ntitle: ${title}\n---\n${dependencyMermaid(graph)}`,
    { limit: Infinity, maxEdges: Infinity, outputLimit: Infinity },
  );
  const start = svg.indexOf(">") + 1;
  return `${svg.slice(0, start)}${svgTheme}<rect width="${width}" height="${height}" fill="var(--_bg)"/>${svg.slice(start)}\n`;
}

export function dependencyHtml(graph: DependencyGraph): string {
  return dependencyViewerHtml({ graph, analysis: analyzeDependencies(graph) });
}
function mermaidText(value: string): string {
  return [...value.slice(0, 180)]
    .map((character) =>
      /[\p{L}\p{N} .:_-]/u.test(character)
        ? character
        : `#${character.codePointAt(0)};`,
    )
    .join("");
}
