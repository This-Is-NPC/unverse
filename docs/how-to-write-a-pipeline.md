# Write and run a pipeline

**The question:** How do I keep my own data logic in my repository and have
Unverse turn what it produces into a reviewed data plan?

This page is enough on its own for a new pipeline. It needs
[a configured environment](how-to-connect-an-environment.md) and
[a satisfied schema](how-to-apply-schema.md) for the rows your pipeline
returns. Applying the plan is the shared step of
[the seed page](how-to-seed-data.md).

A pipeline is a file that returns the rows a target should hold. It cannot
write: Unverse validates what it returns, builds a plan, and only
`unverse apply` writes. **A pipeline is not sandboxed.** It is your code and
it runs with your permissions: it can read files, use the network, and read
environment variables, including credentials. Unverse guarantees only that
the context it hands the pipeline cannot write. Review a pipeline as you
would any script. Loading it runs its top-level code, so `pipeline list` and
`pipeline show` run that code too.

## Before you start

- Work in a project with `.unverse/config.json`. Pipelines live next to it, in
  `.unverse/pipelines/<name>.mjs` or `.unverse/pipelines/<name>.ts`. A name is
  lowercase letters, digits, and hyphens. `seed`, `purge`, and `transfer` are
  built in and cannot be reused.
- Node.js 24 runs `.ts` files directly by stripping the types, so use only
  type annotations and no enums. A `.mjs` file needs no types.
- The [example](examples/families.mjs) used below creates parent rows, each
  with one child row, for the model in `schema.json` and the mapping in
  `transfer-mapping.json`, both placeholders for your own files in the project
  root. The outputs below come from the installed program against synthetic
  fixtures; the project path is shown as `/work/project`, and each result is
  cut to its `data` member.

## Steps

1. Copy the example into your project:

   ```sh
   mkdir -p .unverse/pipelines
   cp families.mjs .unverse/pipelines/families.mjs
   ```

   The file's default export has three members:

   - `description`: one line shown by `pipeline list`.
   - `params`: an optional array of flags, each `{ name, value, summary,
     required, choices }`, the same fields every command flag has.
   - `run(ctx)`: returns `{ model, mapping, data }`, where `data` holds the
     rows of every entity with their IDs. Optional `source` and `basis` are
     described in [design §22](design.md#22-pipelines). The optional
     `onExisting` is `"block"` (the default: a target row that differs
     blocks the plan) or `"update"` (the plan updates only the differing
     fields; an identical row is reported `unchanged`). A pipeline that returns
     `purge: true` plans the deletion of its own rows instead; see
     [purge a seed](how-to-seed-data.md#purge-a-seed). Return it from `run`,
     or take it from a flag such as the built-ins' `--on-existing`.

   `ctx` has five members and nothing else:

   | Member | What it gives |
   | --- | --- |
   | `ctx.params` | The parsed flag values, keyed without the leading `--` |
   | `ctx.target` | The `--env` name the plan is for |
   | `ctx.read(environment, path)` | Every page of a read-only OData collection from any configured profile |
   | `ctx.readJson(path)` | A JSON file, relative to the project root |
   | `ctx.seedId(namespace, entity, key)` | The deterministic ID [seed](how-to-seed-data.md) derives |

2. List what Unverse finds:

   ```sh
   unverse pipeline list
   ```

   ```json
   {
     "pipelines": [
       {
         "name": "seed",
         "origin": "built-in",
         "description": "Plan deterministic fixture rows from a versioned declarative seed with keyed rows; existing rows block or update."
       },
       {
         "name": "purge",
         "origin": "built-in",
         "description": "Plan the deletion of exactly the rows a seed derives, children first; apply requires --destructive."
       },
       {
         "name": "transfer",
         "origin": "built-in",
         "description": "Plan a policy-filtered Dataverse-to-Dataverse transfer from an export; existing rows block or update."
       },
       {
         "name": "families",
         "origin": "project",
         "path": "/work/project/.unverse/pipelines/families.mjs",
         "description": "Create synthetic parent rows, each with one child row."
       }
     ]
   }
   ```

3. Read what the pipeline accepts:

   ```sh
   unverse pipeline plan families -- --help
   ```

   ```text
   unverse pipeline plan families -- --count <1|2|3> [--namespace <name>]

   Create synthetic parent rows, each with one child row.

   Effect: read

   Flags:
     --count <1|2|3>     required  How many parent rows to create.
     --namespace <name>            Seed namespace the row IDs derive from (default families).
     -h, --help                    Show this help.
   ```

   `unverse pipeline show families` prints the same description and flags as
   JSON. Pipeline flags go after `--`, and Unverse checks them with the same
   parser as every command: choices, required flags, unknown flags and
   repeated flags are errors with exit 2, before any connection:

   ```sh
   unverse pipeline plan families --env dev -- --count 9
   ```

   ```text
   --count must be one of 1, 2, 3.
   ```

4. Plan against the target and save the plan:

   ```sh
   unverse pipeline plan families --env dev --format json -- --count 2 > families-plan.json
   ```

   The pipeline ran with a read-only context. Unverse validated what it
   returned exactly as it validates a seed, read the target, and wrote a plan
   with `kind: "data"` and `effect: "write"`. It is create-only by default: an existing
   row that differs is blocked, never updated.

5. Check the plan without writing:

   ```sh
   unverse verify families-plan.json --env dev
   ```

   The command exits 1 while rows are missing:

   ```json
   {
     "kind": "data",
     "satisfied": false,
     "create": [
       { "entity": "child", "id": "5332ff50-63df-8b08-a6de-4a870e5516f6" },
       { "entity": "child", "id": "e6357c01-38d7-886f-b7a6-abf53b382a9a" },
       { "entity": "parent", "id": "0c122044-ae0d-875c-bf7a-94d97dc88f58" },
       { "entity": "parent", "id": "c7eb5fd5-720f-8241-ad7b-88f6cf1fdfed" }
     ],
     "blocked": []
   }
   ```

   The fixture environment used for these outputs does not accept writes, so
   this page shows no apply output. Applying is the command of
   [the seed page](how-to-seed-data.md#steps):
   `unverse apply families-plan.json --env dev --confirm`.

6. To run one file once without installing it, pass its path:
   `unverse pipeline plan ./one-off.mjs --env dev -- --count 1`. A name
   resolves in the project; anything with a slash or a `.ts` or `.mjs` ending
   is a path.

## What can go wrong

- A file that is not a pipeline, a name that is not valid, both `.ts` and
  `.mjs` for one name, or a name equal to `seed` or `transfer` exits 2 at
  discovery, and the message names the file.
- Returned data that is not a valid model, mapping, and complete dataset exits
  2 with the validation message. An exception thrown in `run` exits 2 as
  `Pipeline <name> failed: ...`.
- `ctx.read` keeps the Dataverse exit code: 3 for authentication, 4 for
  permission, 5 for a service failure. A profile name that is not in the
  configuration exits 2.
- A plan is bounded to 1000 operations and 4 MB, and blocked rows stop apply;
  see [seed failure rules](how-to-seed-data.md#what-can-go-wrong).

## Next

[Apply the reviewed plan](how-to-seed-data.md#steps), or read
[design §22](design.md#22-pipelines) for the contract.
