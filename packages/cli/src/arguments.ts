import {
  type CommandSpec,
  commandFlags,
  commandGroups,
  type Format,
  knownFlag,
  type Route,
  resources,
  routes,
} from "./commands.js";
import {
  groupMessage,
  renderCommandHelp,
  renderGroupHelp,
  renderHelp,
} from "./help.js";

export class InputError extends Error {}

export interface Invocation {
  readonly route: Route;
  readonly flags: ReadonlyMap<string, string>;
  readonly positionals: ReadonlyMap<string, string>;
  readonly rest: readonly string[];
  readonly format: Format;
}

export type Parsed =
  | {
      readonly kind: "help";
      readonly text: string;
      readonly requested: boolean;
    }
  | ({ readonly kind: "run" } & Invocation);

function beforeSeparator(argv: readonly string[]): readonly string[] {
  const end = argv.indexOf("--");
  return end === -1 ? argv : argv.slice(0, end);
}

export function requestsJson(argv: readonly string[]): boolean {
  const tokens = beforeSeparator(argv);
  return tokens.some(
    (token, index) =>
      token === "--format=json" ||
      (token === "--format" && tokens[index + 1] === "json"),
  );
}

export function parseInvocation(argv: readonly string[]): Parsed {
  const requested = beforeSeparator(argv).some(
    (token) => token === "-h" || token === "--help",
  );
  const [first, second] = argv;
  if (first === undefined || first.startsWith("-")) {
    if (first === undefined || requested)
      return { kind: "help", text: renderHelp(), requested: true };
    throw new InputError(`Expected a command before ${first}. Use --help.`);
  }
  const resource = resources.find((candidate) => candidate.name === first);
  if (
    resource !== undefined &&
    (second === undefined || second.startsWith("-"))
  )
    return { kind: "help", text: renderGroupHelp(resource), requested };
  const verb = resource === undefined ? undefined : second;
  const route = routes.find((candidate) =>
    resource === undefined
      ? candidate.resource === undefined && candidate.path === first
      : candidate.resource === resource && candidate.command.name === verb,
  );
  if (route === undefined)
    throw new InputError(
      resource === undefined
        ? `Unknown command ${first}. Use --help.`
        : `Unknown command ${first} ${verb}. Use unverse ${first} --help.`,
    );
  if (requested)
    return { kind: "help", text: renderCommandHelp(route), requested };
  return {
    kind: "run",
    ...parseCommand(route, argv.slice(resource === undefined ? 1 : 2)),
  };
}

export function parseCommand(
  route: Route,
  argumentsList: readonly string[],
): Invocation {
  const command: CommandSpec = route.command;
  const separator =
    command.passthrough === true ? argumentsList.indexOf("--") : -1;
  const tokens =
    separator === -1 ? argumentsList : argumentsList.slice(0, separator);
  const flags = commandFlags(command);
  const values = new Map<string, string>();
  const words: string[] = [];
  let literal = false;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    if (literal || !token.startsWith("-") || token === "-") {
      words.push(token);
      continue;
    }
    if (token === "--") {
      literal = true;
      continue;
    }
    if (!token.startsWith("--")) throw new InputError(`Unknown flag ${token}.`);
    const equals = token.indexOf("=");
    const name = equals === -1 ? token : token.slice(0, equals);
    const flag = flags.find((candidate) => candidate.name === name);
    if (flag === undefined)
      throw new InputError(
        knownFlag(name)
          ? `Flag ${name} is not valid for ${route.path}.`
          : `Unknown flag ${name}.`,
      );
    if (values.has(name)) throw new InputError(`Duplicate flag ${name}.`);
    if (flag.value === null) {
      if (equals !== -1) throw new InputError(`${name} does not take a value.`);
      values.set(name, "true");
    } else if (equals !== -1) {
      values.set(name, token.slice(equals + 1));
    } else {
      const next = tokens[index + 1];
      if (next === undefined || next.startsWith("-"))
        throw new InputError(`${name} requires a value.`);
      values.set(name, next);
      index += 1;
    }
  }
  const declared = command.positionals ?? [];
  const missing = declared.find(
    (positional, index) =>
      positional.optional !== true && words[index] === undefined,
  );
  if (missing !== undefined)
    throw new InputError(`<${missing.name}> is required.`);
  if (words.length > declared.length)
    throw new InputError(`Unexpected argument ${words[declared.length]}.`);
  for (const [index, positional] of declared.entries()) {
    const word = words[index] ?? "";
    if (positional.choices !== undefined && !positional.choices.includes(word))
      throw new InputError(
        `Unknown ${positional.name} ${word}; choose one of ${positional.choices.join(", ")}.`,
      );
  }
  for (const flag of flags) {
    if (flag.required === true && !values.has(flag.name))
      throw new InputError(`${flag.name} is required.`);
    const value = values.get(flag.name);
    if (
      value !== undefined &&
      flag.choices !== undefined &&
      !flag.choices.includes(value)
    )
      throw new InputError(
        `${flag.name} must be one of ${flag.choices.join(", ")}.`,
      );
  }
  for (const group of commandGroups(command)) {
    if (group.flags.filter((name) => values.has(name)).length !== 1)
      throw new InputError(groupMessage(group));
  }
  return {
    route,
    flags: values,
    positionals: new Map(
      declared.map(({ name }, index) => [name, words[index] ?? ""]),
    ),
    rest: separator === -1 ? [] : argumentsList.slice(separator + 1),
    format: (values.get("--format") ?? "human") as Format,
  };
}
