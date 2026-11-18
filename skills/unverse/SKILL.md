---
name: unverse
description: Use when inspecting or changing Microsoft Dataverse environments with the unverse CLI, checking artifacts against project rules, or running project pipelines. Covers the plan-then-apply workflow, effects, exit codes, and the .unverse project layout.
---

# Unverse

## Rules

- `read` commands change nothing: run them freely.
- Change anything only by plan → show the plan to the user → after their yes,
  `unverse apply <plan> --env <name> --confirm` (plus `--destructive` when the
  plan's `effect` is `destructive`) → `unverse verify <plan> --env <name>`.
  Never add `--confirm` or `--destructive` on your own.
- Pass `--env <name>` (or `UNVERSE_ENV`). Never guess an environment; ask, and
  `unverse env list` shows the choices. On an organization-pin mismatch
  (exit 2), stop and tell the user; never edit the pin.
- Pass `--format json`: stdout is one JSON document (`status`, `environment`,
  `data`, `coverage`, `errors`). Exit codes: 0 ok, 1 expectation not met or
  violation, 2 invalid input or config, 3 authentication, 4 permission,
  5 service, 6 unsupported, 7 inconclusive or partial. Never report 7 as a pass.
- Never print, ask for, or read secret values or `.env` files; profiles hold
  only variable names.

## Project

`.unverse/` is found from the current directory upward:
`config.json` (profiles; `unverse init --confirm` writes a template),
`seeds/<name>.json`, `pipelines/<name>.ts|.mjs`, optional `artifacts.json`
(types and rules for `artifact check`).

A pipeline's default export is `{ description, params?, run(ctx) }`; `run`
returns `{ model, mapping, data }` and cannot write. `ctx` has `params`,
`target`, `read(env, path)`, `readJson(path)`, `seedId(namespace, entity, key)`.
Pipeline files run with the user's permissions: read one before running
`pipeline list|show|plan` on it. Built-ins: `seed`, `transfer`, `purge`.

Notable options: `schema plan --prune` and the `purge` pipeline make
destructive plans; `app list` and `flow list --source platform` also find apps
and flows outside Dataverse tables.

## Commands

Generated from the command spec by `mise run skill`; do not edit. Only
positionals, required flags and `(a | b)` exactly-one groups are shown; every
command also takes `--config`, `--env` and `--format`, and
`unverse <command> --help` lists the rest.

<!-- BEGIN GENERATED COMMANDS: mise run skill -->

### read

- `config check`
- `env list`
- `env whoami`
- `env doctor`
- `env compare --target-env <name>`
- `table list`
- `record query <table> --select <columns>`
- `schema inspect --mapping-file <path>`
- `schema plan --mapping-file <path> --model-file <path>`
- `solution list`
- `solution show <solution-id>`
- `app list`
- `flow list`
- `artifact types`
- `artifact list <type>`
- `artifact check [type]`
- `user list`
- `user show (--user-id <guid> | --email <email> | --domain <name> | --name <full-name> | --caller)`
- `role check (--user-id <guid> | --email <email> | --domain <name> | --name <full-name> | --caller) (--role-id <guid> | --role <name>)`
- `variable list`
- `connector list`
- `connref list`
- `connref show <reference-id>`
- `deps list`
- `deps graph`
- `deps impact`
- `access plan --access-file <path>`
- `pipeline list`
- `pipeline show <pipeline>`
- `pipeline plan <pipeline> -- <pipeline flags>`
- `pg export --mapping-file <path> --model-file <path>`
- `pg verify --manifest-file <path>`
- `verify <plan-file>`
- `spec`

### write

- `pg import --confirm --manifest-file <path>`
- `apply <plan-file> --confirm`
- `init --confirm`

<!-- END GENERATED COMMANDS -->
