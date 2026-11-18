# Use the agent skill

**The question:** How do I teach an AI coding agent to use Unverse safely?

This page is enough on its own. It needs no connected environment.

Unverse ships one skill, `unverse`. It tells an agent the observe, plan,
review, apply workflow, which commands are safe to run, the exit codes, and
how to treat secrets and environments. Its command list is generated from the
command spec, so it matches the installed version.

## Before you start

- `<skills-directory>` below is a placeholder for the directory your agent
  reads skills from. Its location depends on the agent; see its documentation.
- The skill is a directory named `unverse` holding one file, `SKILL.md`.

## Steps

1. Find the skill.
   - In a checkout of this repository: `skills/unverse/SKILL.md`.
   - In an installed `@unverse/cli` package:
     `node_modules/@unverse/cli/dist/skills/unverse/SKILL.md`.

2. Copy the `skills/unverse` directory into your agent's skills directory:

   ```sh
   cp -r skills/unverse <skills-directory>/unverse
   ```

   From an installed package, copy `dist/skills/unverse` instead.

3. Allow the agent to run `read` commands without asking. Print the list with
   `unverse spec --format json` and take the commands whose `effect` is
   `read`.

4. Copy the skill again after you update Unverse, so its command list stays
   true.

## What can go wrong

- The agent does not pick the skill up: check that the directory is named
  `unverse` and that the agent reads skills from `<skills-directory>`.
- The command list is stale after an upgrade: copy the new directory over the
  old one.
- Contributors who change commands run `mise run skill`; `mise run check`
  fails while the committed skill is stale.

## Where to go next

- [Connect an environment](how-to-connect-an-environment.md).
- [Write a pipeline](how-to-write-a-pipeline.md).
- [CLI reference](cli.md), generated from the same spec.
