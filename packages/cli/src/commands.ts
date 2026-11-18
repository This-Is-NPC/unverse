import { artifactTypeNames } from "@unverse/core";

export type Effect = "read" | "write" | "destructive";
export type Stage = "observe" | "plan" | "apply" | "other";
export type Format = "human" | "json" | "csv" | "html" | "mermaid" | "svg";

export interface FlagSpec {
  readonly name: string;
  readonly value: string | null;
  readonly summary: string;
  readonly required?: boolean;
  readonly choices?: readonly string[];
}

export interface OneOfGroup {
  readonly name: string;
  readonly flags: readonly string[];
}

export interface FlagsetSpec {
  readonly includes?: readonly string[];
  readonly flags: readonly FlagSpec[];
  readonly groups?: readonly OneOfGroup[];
}

export interface PositionalSpec {
  readonly name: string;
  readonly summary: string;
  readonly choices?: readonly string[];
}

export interface CommandSpec {
  readonly name: string;
  readonly stage: Stage;
  readonly effect: Effect;
  readonly summary: string;
  readonly flagsets: readonly FlagsetName[];
  readonly flags?: readonly FlagSpec[];
  readonly positionals?: readonly PositionalSpec[];
  readonly groups?: readonly OneOfGroup[];
  readonly outputs: readonly Format[];
  readonly exits?: Readonly<Record<number, string>>;
}

export interface ResourceSpec {
  readonly name: string;
  readonly summary: string;
  readonly commands: readonly CommandSpec[];
}

export interface Route {
  readonly path: string;
  readonly resource: ResourceSpec | undefined;
  readonly command: CommandSpec;
}

export const globalExits: Readonly<Record<number, string>> = {
  0: "Operation completed; a check expectation was met",
  1: "A completed check expectation was not met",
  2: "Input or configuration is invalid",
  3: "Authentication failed",
  4: "Permission is insufficient",
  5: "Service or transport failed after allowed retries",
  6: "Capability is unsupported",
  7: "The result is inconclusive or only partially covered",
};

export const stages: readonly {
  readonly stage: Stage;
  readonly title: string;
}[] = [
  { stage: "observe", title: "OBSERVE" },
  { stage: "plan", title: "PLAN" },
  { stage: "apply", title: "APPLY" },
  { stage: "other", title: "OTHER" },
];

const allFormats = [
  "human",
  "json",
  "csv",
  "html",
  "mermaid",
  "svg",
] as const satisfies readonly Format[];
const tabular = ["human", "json", "csv"] as const satisfies readonly Format[];
const graphical = [
  ...tabular,
  "html",
  "mermaid",
  "svg",
] as const satisfies readonly Format[];
const plain = ["human", "json"] as const satisfies readonly Format[];

const flagsets = {
  config: {
    flags: [
      {
        name: "--config",
        value: "path",
        summary:
          "Read this configuration file; overrides UNVERSE_CONFIG and the .unverse/config.json found upward from the current directory.",
      },
    ],
  },
  target: {
    includes: ["config"],
    flags: [
      {
        name: "--env",
        value: "name",
        summary:
          "Select a named environment profile; overrides UNVERSE_ENV, one of the two is required.",
      },
    ],
  },
  output: {
    flags: [
      {
        name: "--format",
        value: "format",
        summary:
          "Select the output format (default human); human is indented JSON.",
        choices: allFormats,
      },
    ],
  },
  write: {
    flags: [
      {
        name: "--confirm",
        value: null,
        summary: "Explicitly authorize the reviewed writes.",
        required: true,
      },
    ],
  },
  destructive: {
    flags: [
      {
        name: "--destructive",
        value: null,
        summary:
          "Authorize a plan whose effect is destructive; the invocation is then destructive.",
      },
    ],
  },
  search: {
    flags: [
      {
        name: "--search",
        value: "text",
        summary:
          "Search names case-insensitively; table searches include labels and entity sets.",
      },
    ],
  },
  mapping: {
    flags: [
      {
        name: "--mapping-file",
        value: "path",
        summary:
          "Read the mapping JSON: prefix, solution, and optional environmentVariables and connectionReferences.",
        required: true,
      },
    ],
  },
  userSelector: {
    flags: [
      { name: "--user-id", value: "guid", summary: "Resolve a user by GUID." },
      {
        name: "--email",
        value: "email",
        summary: "Resolve a user by exact email.",
      },
      {
        name: "--domain",
        value: "name",
        summary: "Resolve a user by exact domain name.",
      },
      {
        name: "--name",
        value: "full-name",
        summary:
          "Resolve an exact full user name; ambiguous names require --user-id.",
      },
      {
        name: "--caller",
        value: null,
        summary:
          "Inspect the authenticated application user returned by WhoAmI.",
      },
    ],
    groups: [
      {
        name: "user",
        flags: ["--user-id", "--email", "--domain", "--name", "--caller"],
      },
    ],
  },
  dependencyScope: {
    flags: [
      {
        name: "--object-id",
        value: "guid",
        summary:
          "Select the underlying component object ID, not a solution membership ID.",
      },
      {
        name: "--component-type",
        value: "integer",
        summary:
          "Pair the object ID with its component type from this environment.",
      },
      {
        name: "--reference-id",
        value: "guid",
        summary:
          "Select a connection reference; its component type is resolved from metadata.",
      },
      {
        name: "--max-nodes",
        value: "count",
        summary: "Bound graph nodes to 2–1000 (default 200).",
      },
      {
        name: "--max-edges",
        value: "count",
        summary: "Bound graph edges to 1–10000 (default 1000).",
      },
      {
        name: "--max-queries",
        value: "count",
        summary:
          "Bound logical collection queries to 1–1000 (default 100), excluding WhoAmI, pagination, and retries.",
      },
      {
        name: "--no-bindings",
        value: null,
        summary:
          "Omit connection-binding enrichment; typed official dependencies remain.",
      },
    ],
  },
} as const satisfies Record<string, FlagsetSpec>;

export type FlagsetName = keyof typeof flagsets;

const solutionFilter: FlagSpec = {
  name: "--solution-id",
  value: "guid",
  summary: "Select a solution by its environment-specific ID.",
};
const direction: FlagSpec = {
  name: "--direction",
  value: "direction",
  summary:
    "Choose traversal direction (list: required; graph: both). Impact always follows dependents.",
  choices: ["required", "dependent", "both"],
};
const depth: FlagSpec = {
  name: "--depth",
  value: "hops",
  summary:
    "Bound traversal to 0–10 hops from each root (default 3). A frontier remains explicitly unexplored.",
};
const planFile: PositionalSpec = {
  name: "plan-file",
  summary: "Read a reviewed plan or its JSON result envelope.",
};
const modelFile: FlagSpec = {
  name: "--model-file",
  value: "path",
  summary: "Read the versioned logical schema model.",
  required: true,
};
const manifestFile: FlagSpec = {
  name: "--manifest-file",
  value: "path",
  summary: "Read a canonical transfer manifest or its result envelope.",
  required: true,
};
const incompleteGraph = {
  7: "The graph or its dependency closure is incomplete.",
} as const;

const sourceFlag: FlagSpec = {
  name: "--source",
  value: "source",
  summary:
    "Read from Dataverse tables or the Power Platform API (default dataverse).",
  choices: ["dataverse", "platform"],
};

export const resources: readonly ResourceSpec[] = [
  {
    name: "config",
    summary: "Check local configuration.",
    commands: [
      {
        name: "check",
        stage: "other",
        effect: "read",
        summary:
          "Validate a named local environment without contacting Dataverse.",
        flagsets: ["target", "output"],
        outputs: tabular,
      },
    ],
  },
  {
    name: "env",
    summary: "Inspect and compare environment profiles.",
    commands: [
      {
        name: "list",
        stage: "other",
        effect: "read",
        summary:
          "List configured environment names and normalized URLs without contacting Dataverse.",
        flagsets: ["config", "output"],
        outputs: tabular,
      },
      {
        name: "whoami",
        stage: "observe",
        effect: "read",
        summary:
          "Identify the Dataverse organization, caller, and business unit.",
        flagsets: ["target", "output"],
        outputs: tabular,
      },
      {
        name: "doctor",
        stage: "observe",
        effect: "read",
        summary:
          "Probe configuration, token acquisition, and Dataverse WhoAmI.",
        flagsets: ["target", "output"],
        outputs: tabular,
      },
      {
        name: "compare",
        stage: "observe",
        effect: "read",
        summary:
          "Compare solution versions and masked variable configuration between explicit profiles.",
        flagsets: ["target", "output"],
        flags: [
          {
            name: "--target-env",
            value: "name",
            summary: "Select an explicit target environment profile.",
            required: true,
          },
          {
            name: "--scope",
            value: "scope",
            summary: "Choose comparison scope (default all).",
            choices: ["solutions", "variables", "components", "all"],
          },
          {
            name: "--component-solution",
            value: "unique-name",
            summary:
              "Compare typed component membership for this solution in both profiles.",
          },
        ],
        outputs: tabular,
        exits: {
          1: "The compared environments differ.",
          7: "A compared scope could not be determined.",
        },
      },
    ],
  },
  {
    name: "table",
    summary: "Discover Dataverse tables.",
    commands: [
      {
        name: "list",
        stage: "observe",
        effect: "read",
        summary:
          "Discover Dataverse table names, entity sets, and primary keys.",
        flagsets: ["target", "output", "search"],
        outputs: tabular,
      },
    ],
  },
  {
    name: "record",
    summary: "Read table rows.",
    commands: [
      {
        name: "query",
        stage: "observe",
        effect: "read",
        summary: "Repeat a read-only OData query with explicit completeness.",
        flagsets: ["target", "output"],
        positionals: [
          {
            name: "table",
            summary: "Resolve this table's entity set through metadata.",
          },
        ],
        flags: [
          {
            name: "--select",
            value: "columns",
            summary: "Select comma-separated logical column names.",
            required: true,
          },
          {
            name: "--filter-file",
            value: "path",
            summary: "Read an explicit OData filter expression from a file.",
          },
          {
            name: "--order-by",
            value: "ordering",
            summary:
              "Order by comma-separated columns with optional asc or desc.",
          },
          {
            name: "--limit",
            value: "rows",
            summary: "Cap rows and report incomplete coverage when more exist.",
          },
        ],
        outputs: tabular,
        exits: {
          7: "The row cap stopped collection before all matching rows were read.",
        },
      },
    ],
  },
  {
    name: "schema",
    summary: "Inspect metadata and plan additive or pruning changes.",
    commands: [
      {
        name: "inspect",
        stage: "observe",
        effect: "read",
        summary:
          "Inspect normalized metadata within an explicit publisher prefix.",
        flagsets: ["target", "output", "mapping"],
        outputs: tabular,
      },
      {
        name: "plan",
        stage: "plan",
        effect: "read",
        summary:
          "Plan additive metadata changes and report blocked operations; with --prune, plan the deletion of owned structures the model no longer declares.",
        flagsets: ["target", "output", "mapping"],
        flags: [
          modelFile,
          {
            name: "--prune",
            value: null,
            summary:
              "Plan a destructive change that deletes owned keys, relationships and columns outside the model; entities are never deleted.",
          },
        ],
        outputs: tabular,
      },
    ],
  },
  {
    name: "solution",
    summary: "Find solutions and inspect their components.",
    commands: [
      {
        name: "list",
        stage: "observe",
        effect: "read",
        summary: "Find solutions by display or unique name.",
        flagsets: ["target", "output", "search"],
        outputs: tabular,
      },
      {
        name: "show",
        stage: "observe",
        effect: "read",
        summary: "Inspect component membership for an explicit solution ID.",
        flagsets: ["target", "output"],
        positionals: [
          {
            name: "solution-id",
            summary: "Select a solution by its environment-specific ID.",
          },
        ],
        outputs: tabular,
      },
    ],
  },
  {
    name: "app",
    summary: "Find canvas and model-driven apps.",
    commands: [
      {
        name: "list",
        stage: "observe",
        effect: "read",
        summary:
          "Find canvas and model-driven apps without exporting their contents.",
        flagsets: ["target", "output", "search"],
        flags: [
          {
            name: "--kind",
            value: "kind",
            summary: "Choose app kind (default all).",
            choices: ["all", "canvas", "model-driven"],
          },
          sourceFlag,
        ],
        outputs: tabular,
      },
    ],
  },
  {
    name: "flow",
    summary: "Find cloud flows.",
    commands: [
      {
        name: "list",
        stage: "observe",
        effect: "read",
        summary:
          "Find cloud flows without exporting definitions or connection secrets.",
        flagsets: ["target", "output", "search"],
        flags: [sourceFlag],
        outputs: tabular,
      },
    ],
  },
  {
    name: "artifact",
    summary: "Inventory the built-in artifact types.",
    commands: [
      {
        name: "types",
        stage: "other",
        effect: "read",
        summary:
          "List the built-in artifact types with platform names, sources, and fields without contacting Dataverse.",
        flagsets: ["output"],
        outputs: tabular,
      },
      {
        name: "list",
        stage: "observe",
        effect: "read",
        summary:
          "List artifacts of one built-in type as normalized items with only the fields the source provides.",
        flagsets: ["target", "output"],
        positionals: [
          {
            name: "type",
            summary: "Select a built-in artifact type.",
            choices: artifactTypeNames,
          },
        ],
        flags: [
          {
            name: "--limit",
            value: "items",
            summary:
              "Cap items and report incomplete coverage when more exist.",
          },
        ],
        outputs: tabular,
        exits: {
          7: "The item cap stopped the list before all items were returned.",
        },
      },
    ],
  },
  {
    name: "user",
    summary: "Find users and inspect their roles.",
    commands: [
      {
        name: "list",
        stage: "observe",
        effect: "read",
        summary: "Find users to disambiguate role investigation selectors.",
        flagsets: ["target", "output", "search"],
        outputs: tabular,
      },
      {
        name: "show",
        stage: "observe",
        effect: "read",
        summary: "Inspect direct and retrieved-team role assignments.",
        flagsets: ["target", "output", "userSelector"],
        outputs: tabular,
      },
    ],
  },
  {
    name: "role",
    summary: "Check role assignments.",
    commands: [
      {
        name: "check",
        stage: "observe",
        effect: "read",
        summary: "Check a role assignment without claiming effective access.",
        flagsets: ["target", "output", "userSelector"],
        flags: [
          {
            name: "--role-id",
            value: "guid",
            summary: "Check an unambiguous role GUID.",
          },
          {
            name: "--role",
            value: "name",
            summary:
              "Resolve an exact role name; duplicate matches are rejected.",
          },
        ],
        groups: [{ name: "role", flags: ["--role-id", "--role"] }],
        outputs: tabular,
        exits: { 1: "The user does not hold the role." },
      },
    ],
  },
  {
    name: "variable",
    summary: "Inspect environment variables.",
    commands: [
      {
        name: "list",
        stage: "observe",
        effect: "read",
        summary:
          "Inspect environment variable configuration with values always masked.",
        flagsets: ["target", "output", "search"],
        outputs: tabular,
      },
    ],
  },
  {
    name: "connector",
    summary: "Find connector metadata.",
    commands: [
      {
        name: "list",
        stage: "observe",
        effect: "read",
        summary:
          "Find solution-aware connector metadata without retrieving definitions or credentials.",
        flagsets: ["target", "output", "search"],
        flags: [solutionFilter],
        outputs: tabular,
      },
    ],
  },
  {
    name: "connref",
    summary: "Inspect connection references.",
    commands: [
      {
        name: "list",
        stage: "observe",
        effect: "read",
        summary:
          "Find visible connection bindings without claiming connection health.",
        flagsets: ["target", "output", "search"],
        flags: [solutionFilter],
        outputs: tabular,
      },
      {
        name: "show",
        stage: "observe",
        effect: "read",
        summary:
          "Inspect one connection reference by its environment-specific ID.",
        flagsets: ["target", "output"],
        positionals: [
          {
            name: "reference-id",
            summary:
              "Select a connection reference by its environment-specific ID.",
          },
        ],
        outputs: tabular,
      },
    ],
  },
  {
    name: "deps",
    summary: "Trace dependency evidence.",
    commands: [
      {
        name: "list",
        stage: "observe",
        effect: "read",
        summary:
          "Inspect direct required or dependent components using official Dataverse functions.",
        flagsets: ["target", "output", "dependencyScope"],
        flags: [direction],
        outputs: tabular,
        exits: incompleteGraph,
      },
      {
        name: "graph",
        stage: "observe",
        effect: "read",
        summary:
          "Build a bounded evidence graph, with HTML, Mermaid, and SVG visual exports.",
        flagsets: ["target", "output", "dependencyScope"],
        flags: [direction, depth, solutionFilter],
        outputs: graphical,
        exits: incompleteGraph,
      },
      {
        name: "impact",
        stage: "observe",
        effect: "read",
        summary:
          "Trace observed downstream consumers and explain potential impact paths.",
        flagsets: ["target", "output", "dependencyScope"],
        flags: [depth],
        outputs: graphical,
        exits: incompleteGraph,
      },
    ],
  },
  {
    name: "seed",
    summary: "Plan deterministic fixture data.",
    commands: [
      {
        name: "plan",
        stage: "plan",
        effect: "read",
        summary:
          "Generate deterministic fixture IDs and review create-only data operations.",
        flagsets: ["target", "output"],
        flags: [
          {
            name: "--seed-file",
            value: "path",
            summary: "Read a versioned declarative seed with keyed rows.",
            required: true,
          },
        ],
        outputs: tabular,
      },
    ],
  },
  {
    name: "access",
    summary: "Plan security role assignments to teams.",
    commands: [
      {
        name: "plan",
        stage: "plan",
        effect: "read",
        summary:
          "Resolve teams and the roles in their business units and review add-only role assignments.",
        flagsets: ["target", "output"],
        flags: [
          {
            name: "--access-file",
            value: "path",
            summary:
              "Read a versioned document listing teams and the role names each team needs.",
            required: true,
          },
        ],
        outputs: tabular,
      },
    ],
  },
  {
    name: "transfer",
    summary: "Plan a Dataverse-to-Dataverse transfer.",
    commands: [
      {
        name: "plan",
        stage: "plan",
        effect: "read",
        summary:
          "Review a policy-filtered Dataverse-to-Dataverse create-only transfer.",
        flagsets: ["target", "output", "mapping"],
        flags: [
          manifestFile,
          {
            name: "--policy-file",
            value: "path",
            summary:
              "Require an explicit copy or constant rule for every non-key field.",
            required: true,
          },
        ],
        outputs: tabular,
      },
    ],
  },
  {
    name: "pg",
    summary: "Export Dataverse data and move it into PostgreSQL.",
    commands: [
      {
        name: "export",
        stage: "observe",
        effect: "read",
        summary:
          "Export the modeled Dataverse subset into a verified transfer manifest.",
        flagsets: ["target", "output", "mapping"],
        flags: [modelFile],
        outputs: tabular,
      },
      {
        name: "import",
        stage: "apply",
        effect: "write",
        summary:
          "Import into a new owned PostgreSQL schema, or verify a committed transfer on resume.",
        flagsets: ["target", "output", "write"],
        flags: [manifestFile],
        outputs: tabular,
        exits: { 1: "Post-import verification failed." },
      },
      {
        name: "verify",
        stage: "observe",
        effect: "read",
        summary:
          "Verify identities, relationships, decimals, and temporal values in PostgreSQL.",
        flagsets: ["target", "output"],
        flags: [manifestFile],
        outputs: tabular,
        exits: { 1: "Verification failed." },
      },
    ],
  },
];

export const rootCommands: readonly CommandSpec[] = [
  {
    name: "apply",
    stage: "apply",
    effect: "write",
    summary:
      "Apply a reviewed, fresh, environment-bound plan of any kind after explicit confirmation.",
    flagsets: ["target", "output", "write", "destructive"],
    positionals: [planFile],
    outputs: tabular,
    exits: {
      1: "A data or access plan was applied and post-apply verification failed.",
      7: "Operations remain or are blocked after a schema plan was applied.",
    },
  },
  {
    name: "verify",
    stage: "apply",
    effect: "read",
    summary:
      "Re-inspect the target and report whether a plan is satisfied, without writing.",
    flagsets: ["target", "output"],
    positionals: [planFile],
    outputs: tabular,
    exits: { 1: "The plan is not satisfied." },
  },
  {
    name: "spec",
    stage: "other",
    effect: "read",
    summary: "Print the whole command spec as one JSON document.",
    flagsets: ["output"],
    outputs: plain,
  },
  {
    name: "init",
    stage: "other",
    effect: "write",
    summary:
      "Create .unverse/config.json from a template in the current directory.",
    flagsets: ["output", "write"],
    outputs: plain,
  },
];

export const routes: readonly Route[] = [
  ...resources.flatMap((resource) =>
    resource.commands.map((command) => ({
      path: `${resource.name} ${command.name}`,
      resource,
      command,
    })),
  ),
  ...rootCommands.map((command) => ({
    path: command.name,
    resource: undefined,
    command,
  })),
];

function expandFlagset(
  name: FlagsetName,
  outputs: readonly Format[],
): FlagSpec[] {
  const flagset: FlagsetSpec = flagsets[name];
  return [
    ...(flagset.includes ?? []).flatMap((included) =>
      expandFlagset(included as FlagsetName, outputs),
    ),
    ...flagset.flags.map((flag) =>
      name === "output" ? { ...flag, choices: outputs } : flag,
    ),
  ];
}

export function commandFlags(command: CommandSpec): readonly FlagSpec[] {
  return [
    ...command.flagsets.flatMap((name) => expandFlagset(name, command.outputs)),
    ...(command.flags ?? []),
  ];
}

export function commandGroups(command: CommandSpec): readonly OneOfGroup[] {
  return [
    ...command.flagsets.flatMap((name) => {
      const flagset: FlagsetSpec = flagsets[name];
      return flagset.groups ?? [];
    }),
    ...(command.groups ?? []),
  ];
}

export function knownFlag(name: string): boolean {
  return routes.some((route) =>
    commandFlags(route.command).some((flag) => flag.name === name),
  );
}
