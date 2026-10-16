export const commandDefinitions = [
  {
    path: "connectors list",
    summary:
      "Find solution-aware connector metadata without retrieving definitions or credentials.",
  },
  {
    path: "connection-references list",
    summary:
      "Find visible connection bindings without claiming connection health.",
  },
  {
    path: "connection-references inspect",
    summary: "Inspect one connection reference by its environment-specific ID.",
  },
  {
    path: "dependencies list",
    summary:
      "Inspect direct required or dependent components using official Dataverse functions.",
  },
  {
    path: "dependencies graph",
    summary:
      "Build a bounded evidence graph, with HTML, Mermaid, and SVG visual exports.",
  },
  {
    path: "dependencies impact",
    summary:
      "Trace observed downstream consumers and explain potential impact paths.",
  },
  {
    path: "seed plan",
    summary:
      "Generate deterministic fixture IDs and review create-only data operations.",
  },
  {
    path: "seed apply",
    summary: "Apply a reviewed seed plan as one bounded atomic changeset.",
  },
  {
    path: "transfer plan",
    summary:
      "Review a policy-filtered Dataverse-to-Dataverse create-only transfer.",
  },
  {
    path: "transfer apply",
    summary:
      "Apply a reviewed transfer without deleting or overwriting existing rows.",
  },
  {
    path: "solutions list",
    summary: "Find solutions by display or unique name.",
  },
  {
    path: "solution components",
    summary: "Inspect component membership for an explicit solution ID.",
  },
  {
    path: "apps list",
    summary:
      "Find canvas and model-driven apps without exporting their contents.",
  },
  {
    path: "flows list",
    summary:
      "Find cloud flows without exporting definitions or connection secrets.",
  },
  {
    path: "users list",
    summary: "Find users to disambiguate role investigation selectors.",
  },
  {
    path: "variables list",
    summary:
      "Inspect environment variable configuration with values always masked.",
  },
  {
    path: "environment compare",
    summary:
      "Compare solution versions and masked variable configuration between explicit profiles.",
  },
  {
    path: "transfer export",
    summary:
      "Export the modeled Dataverse subset into a verified transfer manifest.",
  },
  {
    path: "transfer import",
    summary:
      "Import into a new owned PostgreSQL schema, or verify a committed transfer on resume.",
  },
  {
    path: "transfer verify",
    summary:
      "Verify identities, relationships, decimals, and temporal values in PostgreSQL.",
  },
  {
    path: "schema inspect",
    summary: "Inspect normalized metadata within an explicit publisher prefix.",
  },
  {
    path: "schema plan",
    summary: "Plan additive metadata changes and report blocked operations.",
  },
  {
    path: "schema apply",
    summary:
      "Apply an explicitly confirmed, fresh, environment-bound schema plan.",
  },
  {
    path: "tables list",
    summary: "Discover Dataverse table names, entity sets, and primary keys.",
  },
  {
    path: "query",
    summary: "Repeat a read-only OData query with explicit completeness.",
  },
  {
    path: "config validate",
    summary: "Validate a named local environment without contacting Dataverse.",
  },
  {
    path: "whoami",
    summary: "Identify the Dataverse organization, caller, and business unit.",
  },
  {
    path: "doctor",
    summary: "Probe configuration, token acquisition, and Dataverse WhoAmI.",
  },
  {
    path: "user roles",
    summary: "Inspect direct and retrieved-team role assignments.",
  },
  {
    path: "check role",
    summary: "Check a role assignment without claiming effective access.",
  },
] as const;

export type CommandName = (typeof commandDefinitions)[number]["path"];

interface OptionDefinition {
  readonly name: string;
  readonly value: string | null;
  readonly summary: string;
  readonly required: boolean;
  readonly requiredFor?: readonly CommandName[];
  readonly commands?: readonly CommandName[];
}

export const optionDefinitions: readonly OptionDefinition[] = [
  {
    name: "--html",
    value: null,
    summary: "Write an offline interactive HTML canvas for a browser.",
    required: false,
    commands: ["dependencies graph", "dependencies impact"],
  },
  {
    name: "--mermaid",
    value: null,
    summary: "Write a safely escaped Mermaid graph for Markdown renderers.",
    required: false,
    commands: ["dependencies graph", "dependencies impact"],
  },
  {
    name: "--svg",
    value: null,
    summary:
      "Write the Mermaid graph as a static SVG rendered offline by Pele.",
    required: false,
    commands: ["dependencies graph", "dependencies impact"],
  },
  {
    name: "--object-id",
    value: "guid",
    summary:
      "Select the underlying component object ID, not a solution membership ID.",
    required: false,
    commands: [
      "dependencies list",
      "dependencies graph",
      "dependencies impact",
    ],
  },
  {
    name: "--component-type",
    value: "integer",
    summary:
      "Pair the object ID with its component type from this environment.",
    required: false,
    commands: [
      "dependencies list",
      "dependencies graph",
      "dependencies impact",
    ],
  },
  {
    name: "--reference-id",
    value: "guid",
    summary:
      "Select a reference; inspect requires it, dependency commands resolve its type from metadata.",
    required: false,
    requiredFor: ["connection-references inspect"],
    commands: [
      "connection-references inspect",
      "dependencies list",
      "dependencies graph",
      "dependencies impact",
    ],
  },
  {
    name: "--direction",
    value: "required|dependent|both",
    summary:
      "Choose traversal direction (list: required; graph: both). Impact always follows dependents.",
    required: false,
    commands: ["dependencies list", "dependencies graph"],
  },
  {
    name: "--depth",
    value: "hops",
    summary:
      "Bound traversal to 0–10 hops from each root (default 3). A frontier remains explicitly unexplored.",
    required: false,
    commands: ["dependencies graph", "dependencies impact"],
  },
  {
    name: "--max-nodes",
    value: "count",
    summary: "Bound graph nodes to 2–1000 (default 200).",
    required: false,
    commands: [
      "dependencies list",
      "dependencies graph",
      "dependencies impact",
    ],
  },
  {
    name: "--max-edges",
    value: "count",
    summary: "Bound graph edges to 1–10000 (default 1000).",
    required: false,
    commands: [
      "dependencies list",
      "dependencies graph",
      "dependencies impact",
    ],
  },
  {
    name: "--max-queries",
    value: "count",
    summary:
      "Bound logical collection queries to 1–1000 (default 100), excluding WhoAmI, pagination, and retries.",
    required: false,
    commands: [
      "dependencies list",
      "dependencies graph",
      "dependencies impact",
    ],
  },
  {
    name: "--no-bindings",
    value: null,
    summary:
      "Omit connection-binding enrichment; typed official dependencies remain.",
    required: false,
    commands: [
      "dependencies list",
      "dependencies graph",
      "dependencies impact",
    ],
  },
  {
    name: "--component-solution",
    value: "unique-name",
    summary:
      "Compare typed component membership for this solution in both profiles.",
    required: false,
    commands: ["environment compare"],
  },
  {
    name: "--name",
    value: "full-name",
    summary:
      "Resolve an exact full user name; ambiguous names require --user-id.",
    required: false,
    commands: ["user roles", "check role"],
  },
  {
    name: "--caller",
    value: null,
    summary: "Inspect the authenticated application user returned by WhoAmI.",
    required: false,
    commands: ["user roles", "check role"],
  },
  {
    name: "--seed-file",
    value: "path",
    summary: "Read a versioned declarative seed with keyed rows.",
    required: true,
    commands: ["seed plan"],
  },
  {
    name: "--policy-file",
    value: "path",
    summary:
      "Require an explicit copy or constant rule for every non-key field.",
    required: true,
    commands: ["transfer plan"],
  },
  {
    name: "--csv",
    value: null,
    summary:
      "Write RFC 4180 CSV with spreadsheet-safe cells; nested values remain JSON.",
    required: false,
  },
  {
    name: "--target-env",
    value: "name",
    summary: "Select an explicit target environment profile.",
    required: true,
    commands: ["environment compare"],
  },
  {
    name: "--scope",
    value: "solutions|variables|components|all",
    summary: "Choose comparison scope (default all).",
    required: false,
    commands: ["environment compare"],
  },
  {
    name: "--kind",
    value: "all|canvas|model-driven",
    summary: "Choose app kind (default all).",
    required: false,
    commands: ["apps list"],
  },
  {
    name: "--solution-id",
    value: "guid",
    summary: "Select a solution by its environment-specific ID.",
    required: false,
    requiredFor: ["solution components"],
    commands: [
      "solution components",
      "connectors list",
      "connection-references list",
      "dependencies graph",
    ],
  },
  {
    name: "--manifest-file",
    value: "path",
    summary: "Read a canonical transfer manifest or its result envelope.",
    required: true,
    commands: ["transfer import", "transfer verify", "transfer plan"],
  },
  {
    name: "--prefix",
    value: "prefix",
    summary: "Select the explicit Dataverse publisher prefix.",
    required: true,
    commands: [
      "schema inspect",
      "schema plan",
      "transfer export",
      "transfer plan",
    ],
  },
  {
    name: "--solution",
    value: "unique-name",
    summary: "Bind the mapping to an existing unmanaged solution.",
    required: true,
    commands: [
      "schema inspect",
      "schema plan",
      "transfer export",
      "transfer plan",
    ],
  },
  {
    name: "--model-file",
    value: "path",
    summary: "Read the versioned logical schema model.",
    required: true,
    commands: ["schema plan", "transfer export"],
  },
  {
    name: "--plan-file",
    value: "path",
    summary: "Read a reviewed plan or its JSON result envelope.",
    required: true,
    commands: ["schema apply", "seed apply", "transfer apply"],
  },
  {
    name: "--confirm",
    value: null,
    summary: "Explicitly authorize the reviewed schema or transfer writes.",
    required: false,
    commands: [
      "schema apply",
      "transfer import",
      "seed apply",
      "transfer apply",
    ],
  },
  {
    name: "--search",
    value: "text",
    summary:
      "Search names case-insensitively; table searches include labels and entity sets.",
    required: false,
    commands: [
      "tables list",
      "solutions list",
      "apps list",
      "flows list",
      "users list",
      "variables list",
      "connectors list",
      "connection-references list",
    ],
  },
  {
    name: "--table",
    value: "logical-name",
    summary: "Resolve a table's entity set through metadata.",
    required: true,
    commands: ["query"],
  },
  {
    name: "--select",
    value: "columns",
    summary: "Select comma-separated logical column names.",
    required: true,
    commands: ["query"],
  },
  {
    name: "--filter-file",
    value: "path",
    summary: "Read an explicit OData filter expression from a file.",
    required: false,
    commands: ["query"],
  },
  {
    name: "--order-by",
    value: "ordering",
    summary: "Order by comma-separated columns with optional asc or desc.",
    required: false,
    commands: ["query"],
  },
  {
    name: "--limit",
    value: "rows",
    summary: "Cap rows and report incomplete coverage when more exist.",
    required: false,
    commands: ["query"],
  },
  {
    name: "--user-id",
    value: "guid",
    summary: "Resolve a user by GUID.",
    required: false,
    commands: ["user roles", "check role"],
  },
  {
    name: "--email",
    value: "email",
    summary: "Resolve a user by exact email.",
    required: false,
    commands: ["user roles", "check role"],
  },
  {
    name: "--domain",
    value: "name",
    summary: "Resolve a user by exact domain name.",
    required: false,
    commands: ["user roles", "check role"],
  },
  {
    name: "--role-id",
    value: "guid",
    summary: "Check an unambiguous role GUID.",
    required: false,
    commands: ["check role"],
  },
  {
    name: "--role",
    value: "name",
    summary: "Resolve an exact role name; duplicate matches are rejected.",
    required: false,
    commands: ["check role"],
  },
  {
    name: "--env",
    value: "name",
    summary: "Select a named environment profile.",
    required: true,
  },
  {
    name: "--config",
    value: "path",
    summary: "Read configuration instead of unverse.config.json.",
    required: false,
  },
  {
    name: "--json",
    value: null,
    summary: "Write one versioned JSON result to stdout.",
    required: false,
  },
] as const;

export function usage(command: CommandName): string {
  const options = commandOptions(command).map((option) => {
    const text =
      option.value === null ? option.name : `${option.name} <${option.value}>`;
    return optionRequired(option, command) ? text : `[${text}]`;
  });
  return `unverse ${command} ${options.join(" ")}`;
}

export function optionRequired(
  option: OptionDefinition,
  command: CommandName,
): boolean {
  return option.required || (option.requiredFor?.includes(command) ?? false);
}

export function commandOptions(
  command: CommandName,
): readonly OptionDefinition[] {
  return optionDefinitions.filter(
    (option) =>
      option.commands === undefined || option.commands.includes(command),
  );
}

export function renderHelp(): string {
  return [
    "Unverse — Unslop your data.",
    "",
    ...commandDefinitions.flatMap((command) => [
      usage(command.path),
      `  ${command.summary}`,
    ]),
    "",
    "Use --help for help. Environment operations require --env.",
    "",
  ].join("\n");
}

export function renderCliReference(): string {
  const sections = commandDefinitions.map((command) =>
    [
      `## ${command.path}`,
      "",
      command.summary,
      "",
      `\`${usage(command.path)}\``,
      "",
      "### Options",
      "",
      ...commandOptions(command.path).map(
        (option) =>
          `- \`${option.name}${option.value === null ? "" : ` <${option.value}>`}\`: ${option.summary}`,
      ),
    ].join("\n"),
  );
  return `# CLI reference\n\nGenerated by \`mise run docs-cli\`. Do not edit by hand.\n\nUse \`unverse --help\` for help.\n\n${sections.join("\n\n")}\n`;
}
