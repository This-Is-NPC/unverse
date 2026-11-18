---
name: unverse
description: Use when inspecting or changing Microsoft Dataverse environments with the unverse CLI, checking artifacts against project rules, or running project pipelines that plan data. Covers the observe, plan, review, apply workflow, effects, exit codes, and the .unverse project layout.
---

# Unverse

Unverse is a CLI for Microsoft Dataverse. It observes an environment, plans
a change as a reviewable file, and writes only when a person confirms the plan.

## Workflow

1. **Observe.** Run `read` commands to learn what exists.
2. **Plan.** Run a plan command and save its JSON result to a file. A plan
   changes nothing.
3. **Review.** Show the plan to the user and wait for their decision.
4. **Apply.** Run `unverse apply <plan> --env <name> --confirm` for a plan
   whose effect is `write`. A plan whose effect is `destructive` also needs
   `--destructive`. Then run `unverse verify <plan> --env <name>`.

## Effects

- Every command declares an effect: `read`, `write`, or `destructive`.
- `read` commands change nothing. Run them freely and allowlist them.
- Never run a `write` or `destructive` command except through
  `unverse apply` after the user has seen the plan and agreed.
- Never add `--confirm` or `--destructive` on your own initiative.

## Output and exit codes

- Always pass `--format json`. Stdout is then exactly one JSON document and
  progress goes to stderr. Read `status`, `environment`, `data`, `errors`, and
  `coverage` from it.
- Read the exit code. Do not treat a non-zero exit as success.

| Exit | Meaning |
| --- | --- |
| 0 | Operation completed; a check expectation was met |
| 1 | A completed check expectation was not met |
| 2 | Input or configuration is invalid |
| 3 | Authentication failed |
| 4 | Permission is insufficient |
| 5 | Service or transport failed after allowed retries |
| 6 | Capability is unsupported |
| 7 | The result is inconclusive or only partially covered |

`apply` exits 7 when a schema plan leaves work undone and 1 when a data plan
fails verification. Report partial coverage; do not call it a pass.

## Secrets

- Never print, request, or write secret values.
- Profiles hold the names of environment variables for the tenant ID, client
  ID, and client secret, not the values.
- Never read `.env` files or dump the environment to find credentials.

## Project layout

Unverse looks for `.unverse/` from the current directory upward.

- `.unverse/config.json`: named environment profiles. Check one with
  `unverse config check`; list them with `unverse env list`.
- `.unverse/seeds/<name>.json`: declarative seed data for `seed` plans.
- `.unverse/pipelines/<name>.mjs` or `.ts`: project pipelines.
- `.unverse/artifacts.json` (optional): artifact types and rules for
  `artifact check`. Without it the check passes and says no rules are declared.

`unverse init` writes a config template into the current directory.

## Environments

- Pass `--env <name>` or set `UNVERSE_ENV`. The flag wins.
- Never guess an environment and never default to one. If the user has not
  named it, ask. Run `unverse env list` to show the choices.
- A profile may pin `expectedOrganizationId`. Unverse then refuses, with exit
  2, to talk to an organization with a different ID. Do not remove or edit a
  pin to get past this error; tell the user.
- Every result records the selected environment. Check it before you act.

## Write a pipeline

A pipeline is `.unverse/pipelines/<name>.mjs` or `.ts` whose default export has
`description`, optional `params` (flags), and `run(ctx)`. `run` returns
`{ model, mapping, data }`: the rows a target should hold. It cannot write;
Unverse validates the result and builds a plan.

- `ctx.params`: parsed flags. `ctx.target`: the `--env` name.
- `ctx.read(environment, path)`: read-only OData from a configured profile.
- `ctx.readJson(path)`: a JSON file relative to the project root.
- `ctx.seedId(namespace, entity, key)`: the deterministic seed ID.

Run `unverse pipeline list`, `unverse pipeline show <name>`, then
`unverse pipeline plan <name> --env <name> -- <pipeline flags>`. A pipeline is
ordinary code with your permissions and is not sandboxed: loading it runs its
top-level code. Read a project pipeline before listing or showing it.

## Documentation

- `unverse --help`, `unverse <group> --help`, and `unverse <command> --help`.
- `unverse spec --format json`: the full command spec.
- In the repository: [CLI reference](../../docs/cli.md),
  [pipelines](../../docs/how-to-write-a-pipeline.md),
  [artifact checks](../../docs/how-to-check-artifacts.md),
  [design](../../docs/design.md). This skill works without them.

## What Unverse does not do

- It does not write without a confirmed plan.
- It does not delete tables, delete data, or lower role privileges outside a
  reviewed destructive plan.
- It does not hold or manage credentials; it reads them from named variables.
- It does not check a user's effective access.
- It has no server, TUI, or dashboard. Graph commands emit files.

## Commands

Generated from the command spec by `mise run skill`. Do not edit by hand.
Run `unverse <command> --help` for details. `[x]` is optional; `(a | b)` means
exactly one.

<!-- BEGIN GENERATED COMMANDS: mise run skill -->

### OBSERVE

- `env whoami` (effect: read): `unverse env whoami [--config <path>] [--env <name>] [--format <human|json|csv>]`
- `env doctor` (effect: read): `unverse env doctor [--config <path>] [--env <name>] [--format <human|json|csv>]`
- `env compare` (effect: read): `unverse env compare [--config <path>] [--env <name>] [--format <human|json|csv>] --target-env <name> [--scope <solutions|variables|components|all>] [--component-solution <unique-name>]`
- `table list` (effect: read): `unverse table list [--config <path>] [--env <name>] [--format <human|json|csv>] [--search <text>]`
- `record query` (effect: read): `unverse record query <table> [--config <path>] [--env <name>] [--format <human|json|csv>] --select <columns> [--filter-file <path>] [--order-by <ordering>] [--limit <rows>]`
- `schema inspect` (effect: read): `unverse schema inspect [--config <path>] [--env <name>] [--format <human|json|csv>] --mapping-file <path>`
- `solution list` (effect: read): `unverse solution list [--config <path>] [--env <name>] [--format <human|json|csv>] [--search <text>]`
- `solution show` (effect: read): `unverse solution show <solution-id> [--config <path>] [--env <name>] [--format <human|json|csv>]`
- `app list` (effect: read): `unverse app list [--config <path>] [--env <name>] [--format <human|json|csv>] [--search <text>] [--kind <all|canvas|model-driven>] [--source <dataverse|platform>]`
- `flow list` (effect: read): `unverse flow list [--config <path>] [--env <name>] [--format <human|json|csv>] [--search <text>] [--source <dataverse|platform>]`
- `artifact list` (effect: read): `unverse artifact list <type> [--config <path>] [--env <name>] [--artifacts-file <path>] [--format <human|json|csv>] [--limit <items>]`
- `artifact check` (effect: read): `unverse artifact check [type] [--config <path>] [--env <name>] [--artifacts-file <path>] [--format <human|json|csv>]`
- `user list` (effect: read): `unverse user list [--config <path>] [--env <name>] [--format <human|json|csv>] [--search <text>]`
- `user show` (effect: read): `unverse user show [--config <path>] [--env <name>] [--format <human|json|csv>] (--user-id <guid> | --email <email> | --domain <name> | --name <full-name> | --caller)`
- `role check` (effect: read): `unverse role check [--config <path>] [--env <name>] [--format <human|json|csv>] (--user-id <guid> | --email <email> | --domain <name> | --name <full-name> | --caller) (--role-id <guid> | --role <name>)`
- `variable list` (effect: read): `unverse variable list [--config <path>] [--env <name>] [--format <human|json|csv>] [--search <text>]`
- `connector list` (effect: read): `unverse connector list [--config <path>] [--env <name>] [--format <human|json|csv>] [--search <text>] [--solution-id <guid>]`
- `connref list` (effect: read): `unverse connref list [--config <path>] [--env <name>] [--format <human|json|csv>] [--search <text>] [--solution-id <guid>]`
- `connref show` (effect: read): `unverse connref show <reference-id> [--config <path>] [--env <name>] [--format <human|json|csv>]`
- `deps list` (effect: read): `unverse deps list [--config <path>] [--env <name>] [--format <human|json|csv>] [--object-id <guid>] [--component-type <integer>] [--reference-id <guid>] [--max-nodes <count>] [--max-edges <count>] [--max-queries <count>] [--no-bindings] [--direction <required|dependent|both>]`
- `deps graph` (effect: read): `unverse deps graph [--config <path>] [--env <name>] [--format <human|json|csv|html|mermaid|svg>] [--object-id <guid>] [--component-type <integer>] [--reference-id <guid>] [--max-nodes <count>] [--max-edges <count>] [--max-queries <count>] [--no-bindings] [--direction <required|dependent|both>] [--depth <hops>] [--solution-id <guid>]`
- `deps impact` (effect: read): `unverse deps impact [--config <path>] [--env <name>] [--format <human|json|csv|html|mermaid|svg>] [--object-id <guid>] [--component-type <integer>] [--reference-id <guid>] [--max-nodes <count>] [--max-edges <count>] [--max-queries <count>] [--no-bindings] [--depth <hops>]`
- `pg export` (effect: read): `unverse pg export [--config <path>] [--env <name>] [--format <human|json|csv>] --mapping-file <path> --model-file <path>`
- `pg verify` (effect: read): `unverse pg verify [--config <path>] [--env <name>] [--format <human|json|csv>] --manifest-file <path>`

### PLAN

- `schema plan` (effect: read): `unverse schema plan [--config <path>] [--env <name>] [--format <human|json|csv>] --mapping-file <path> --model-file <path> [--prune]`
- `access plan` (effect: read): `unverse access plan [--config <path>] [--env <name>] [--format <human|json|csv>] --access-file <path>`
- `pipeline plan` (effect: read): `unverse pipeline plan <pipeline> [--config <path>] [--env <name>] [--format <human|json|csv>] [-- <pipeline flags>]`

### APPLY

- `pg import` (effect: write): `unverse pg import [--config <path>] [--env <name>] [--format <human|json|csv>] --confirm --manifest-file <path>`
- `apply` (effect: write): `unverse apply <plan-file> [--config <path>] [--env <name>] [--format <human|json|csv>] --confirm [--destructive]`
- `verify` (effect: read): `unverse verify <plan-file> [--config <path>] [--env <name>] [--format <human|json|csv>]`

### OTHER

- `config check` (effect: read): `unverse config check [--config <path>] [--env <name>] [--format <human|json|csv>]`
- `env list` (effect: read): `unverse env list [--config <path>] [--format <human|json|csv>]`
- `artifact types` (effect: read): `unverse artifact types [--artifacts-file <path>] [--format <human|json|csv>]`
- `pipeline list` (effect: read): `unverse pipeline list [--config <path>] [--format <human|json|csv>]`
- `pipeline show` (effect: read): `unverse pipeline show <pipeline> [--config <path>] [--format <human|json|csv>]`
- `spec` (effect: read): `unverse spec [--format <human|json>]`
- `init` (effect: write): `unverse init [--format <human|json>] --confirm`

<!-- END GENERATED COMMANDS -->
