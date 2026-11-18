import {
  type CommandSpec,
  commandFlags,
  commandGroups,
  type FlagSpec,
  globalExits,
  type OneOfGroup,
  type PositionalSpec,
  type ResourceSpec,
  type Route,
  resources,
  routes,
  stages,
} from "./commands.js";

const specVersion = 1;

export function flagText(flag: FlagSpec): string {
  if (flag.value === null) return flag.name;
  return `${flag.name} <${flag.choices?.join("|") ?? flag.value}>`;
}

function groupText(group: OneOfGroup, flags: readonly FlagSpec[]): string {
  return `(${group.flags
    .map((name) =>
      flagText(flags.find((flag) => flag.name === name) as FlagSpec),
    )
    .join(" | ")})`;
}

function positionalSummary(positional: PositionalSpec): string {
  return positional.choices === undefined
    ? positional.summary
    : `${positional.summary} One of: ${positional.choices.join(", ")}.`;
}

function positionalText(positional: PositionalSpec): string {
  return positional.optional === true
    ? `[${positional.name}]`
    : `<${positional.name}>`;
}

export function usage(route: Route): string {
  const flags = commandFlags(route.command);
  const groups = commandGroups(route.command);
  const grouped = new Set(groups.flatMap((group) => group.flags));
  return [
    "unverse",
    route.path,
    ...(route.command.positionals ?? []).map(positionalText),
    ...flags
      .filter((flag) => !grouped.has(flag.name))
      .map((flag) =>
        flag.required === true ? flagText(flag) : `[${flagText(flag)}]`,
      ),
    ...groups.map((group) => groupText(group, flags)),
    ...(route.command.passthrough === true ? ["[-- <pipeline flags>]"] : []),
  ].join(" ");
}

export function groupMessage(group: OneOfGroup): string {
  const names = group.flags;
  return `Select exactly one of ${
    names.length === 2
      ? names.join(" or ")
      : `${names.slice(0, -1).join(", ")}, or ${names.at(-1)}`
  }.`;
}

const passthroughMessage =
  "Everything after -- is parsed against the pipeline's own flags; unverse pipeline show lists them.";

function formatsText(command: CommandSpec): string {
  return command.outputs
    .map((format, index) => (index === 0 ? `${format} (default)` : format))
    .join(", ");
}

function columns(rows: readonly (readonly string[])[]): string[] {
  const widths = (rows[0] ?? []).map((_, column) =>
    Math.max(...rows.map((row) => row[column]?.length ?? 0)),
  );
  return rows.map((row) =>
    row
      .map((cell, column) =>
        column === row.length - 1 ? cell : cell.padEnd(widths[column] ?? 0),
      )
      .join("  "),
  );
}

export function renderHelp(): string {
  return [
    "Unverse — Unslop your data.",
    "",
    "Usage: unverse <group> <command> [flags]",
    "",
    ...stages.flatMap(({ stage, title }) => [
      title,
      ...columns(
        routes
          .filter((route) => route.command.stage === stage)
          .map((route) => [
            `  ${route.path}`,
            route.command.effect,
            route.command.summary,
          ]),
      ),
      "",
    ]),
    "Use unverse <group> --help for a group and unverse <command> --help for a command.",
    "",
  ].join("\n");
}

export function renderGroupHelp(resource: ResourceSpec): string {
  return [
    `unverse ${resource.name} — ${resource.summary}`,
    "",
    ...columns(
      resource.commands.map((command) => [
        `  unverse ${resource.name} ${command.name}`,
        command.effect,
        command.summary,
      ]),
    ),
    "",
    `Use unverse ${resource.name} <command> --help for a command.`,
    "",
  ].join("\n");
}

export function renderCommandHelp(route: Route): string {
  const flags = commandFlags(route.command);
  return [
    usage(route),
    "",
    route.command.summary,
    "",
    `Effect: ${route.command.effect}`,
    ...(route.command.outputs.length === 0
      ? []
      : [`Formats: ${formatsText(route.command)}`]),
    ...((route.command.positionals ?? []).length === 0
      ? []
      : [
          "",
          "Arguments:",
          ...columns(
            (route.command.positionals ?? []).map((positional) => [
              `  ${positionalText(positional)}`,
              positionalSummary(positional),
            ]),
          ),
        ]),
    "",
    "Flags:",
    ...columns([
      ...flags.map((flag) => [
        `  ${flagText(flag)}`,
        flag.required === true ? "required" : "",
        flag.summary,
      ]),
      ["  -h, --help", "", "Show this help."],
    ]),
    ...commandGroups(route.command).flatMap((group) => [
      "",
      groupMessage(group),
    ]),
    ...(route.command.passthrough === true ? ["", passthroughMessage] : []),
    ...(route.command.exits === undefined
      ? []
      : [
          "",
          "Exit codes beyond the global table:",
          ...Object.entries(route.command.exits).map(
            ([code, meaning]) => `  ${code}  ${meaning}`,
          ),
        ]),
    "",
  ].join("\n");
}

function renderCommandReference(route: Route): string {
  const command = route.command;
  const flags = commandFlags(command);
  const bullets = (items: readonly string[]) => ["", ...items, ""];
  return [
    `## ${route.path}`,
    "",
    command.summary,
    "",
    `- Effect: \`${command.effect}\``,
    `- Output formats: ${command.outputs.map((format, index) => `\`${format}\`${index === 0 ? " (default)" : ""}`).join(", ")}`,
    "",
    `\`${usage(route)}\``,
    ...((command.positionals ?? []).length === 0
      ? []
      : [
          "",
          "### Arguments",
          ...bullets(
            (command.positionals ?? []).map(
              (positional) =>
                `- \`${positionalText(positional)}\`: ${positionalSummary(positional)}`,
            ),
          ),
        ]),
    "",
    "### Flags",
    ...bullets(
      flags.map(
        (flag) =>
          `- \`${flagText(flag)}\`${flag.required === true ? " (required)" : ""}: ${flag.summary}`,
      ),
    ),
    ...commandGroups(command).flatMap((group) => [
      "### Exactly one of",
      ...bullets([`- ${groupMessage(group)}`]),
    ]),
    ...(command.passthrough === true
      ? ["### Pipeline flags", ...bullets([`- ${passthroughMessage}`])]
      : []),
    ...(command.exits === undefined
      ? []
      : [
          "### Exit codes",
          ...bullets(
            Object.entries(command.exits).map(
              ([code, meaning]) => `- \`${code}\`: ${meaning}`,
            ),
          ),
        ]),
  ]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}

export function renderCliReference(): string {
  return `# CLI reference

Generated by \`mise run docs-cli\`. Do not edit by hand.

Use \`unverse --help\` for help, \`unverse <group> --help\` for a group, and
\`unverse spec\` for the same information as one JSON document. Every command
declares its effect: \`read\` commands change nothing in Dataverse or
PostgreSQL, and \`write\` commands require \`--confirm\`.

Exit codes follow [the global table](design.md#8-results-and-exits); a command
lists only the meanings it adds.

${routes.map(renderCommandReference).join("\n\n")}
`;
}

export function renderSkillCommands(): string {
  return stages
    .flatMap(({ stage, title }) => [
      `### ${title}`,
      "",
      ...routes
        .filter((route) => route.command.stage === stage)
        .map(
          (route) =>
            `- \`${route.path}\` (effect: ${route.command.effect}): \`${usage(route)}\``,
        ),
      "",
    ])
    .join("\n")
    .trimEnd();
}

export function specDocument(): unknown {
  return {
    specVersion,
    name: "unverse",
    exitCodes: globalExits,
    resources: resources.map(({ name, summary }) => ({ name, summary })),
    commands: routes.map(({ path, resource, command }) => ({
      path,
      resource: resource?.name ?? null,
      stage: command.stage,
      effect: command.effect,
      summary: command.summary,
      flagsets: command.flagsets,
      flags: commandFlags(command),
      positionals: command.positionals ?? [],
      groups: commandGroups(command),
      passthrough: command.passthrough === true,
      outputs: { formats: command.outputs, default: command.outputs[0] },
      exits: command.exits ?? {},
    })),
  };
}
