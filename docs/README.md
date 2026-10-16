# Documentation

Unverse's local release candidate supports caller identity, role assignments,
metadata discovery, OData reads, guarded additive schema changes, and verified
Dataverse-to-PostgreSQL transfer, resource discovery, masked environment
comparison, deterministic seed, and create-only Dataverse transfer. The
[installation instructions](../README.md#install) describe local candidate
tarballs; no npm publication is implied.

## Start here

1. [Connect an environment](how-to-connect-an-environment.md), then identify
   the caller with [WhoAmI](cli.md#whoami).
2. [List roles](how-to-list-user-roles.md) or
   [check an assignment](how-to-check-a-role.md).
3. [Discover tables](how-to-discover-tables.md), then
   [query records](how-to-query-records.md).
4. See [terminal views](screens.md) and the generated [CLI reference](cli.md).
5. [Inspect schema](how-to-inspect-schema.md), [plan a change](how-to-plan-schema.md),
   then [apply the reviewed plan](how-to-apply-schema.md).
6. [Export data](how-to-export-data.md), [import it](how-to-import-data.md),
   and [verify the transfer](how-to-verify-transfer.md).
7. Contributors start with [design](design.md) and [agent rules](../AGENTS.md).

## When you know what you want

| Question | Page |
| --- | --- |
| What is the proposed scope and architecture? | [Design](design.md) |
| How do I validate an environment profile? | [CLI reference](cli.md#config-validate) |
| How do I connect a development environment? | [Connect an environment](how-to-connect-an-environment.md) |
| Which roles are assigned to a user? | [List user roles](how-to-list-user-roles.md) |
| How can CI check a role assignment? | [Check a role](how-to-check-a-role.md) |
| Which entity set and key belong to a table? | [Discover tables](how-to-discover-tables.md) |
| How do I repeat a paginated read? | [Query records](how-to-query-records.md) |
| What exists under a mapped prefix? | [Inspect schema](how-to-inspect-schema.md) |
| Which schema changes are safe? | [Plan schema](how-to-plan-schema.md) |
| How do I apply a reviewed plan? | [Apply schema](how-to-apply-schema.md) |
| How do I export modeled rows? | [Export data](how-to-export-data.md) |
| How do I import without overwriting existing tables? | [Import data](how-to-import-data.md) |
| How do I check transfer equivalence? | [Verify transfer](how-to-verify-transfer.md) |
| How do I find apps, flows, solutions, and users? | [Discover resources](how-to-discover-resources.md) |
| Which environment settings differ? | [Compare environments](how-to-compare-environments.md) |
| How do I export results for a spreadsheet? | [CSV output](how-to-export-csv.md) |
| How do I seed reproducible development data? | [Seed data](how-to-seed-data.md) |
| How do I transfer without clearing the destination? | [Dataverse transfer](how-to-transfer-dataverse.md) |
| Which connector and connection bindings are visible? | [Inspect connections](how-to-inspect-connections.md) |
| How do I visualize artifact dependencies? | [Explore dependencies](how-to-explore-dependencies.md) |
| Which observed consumers should I review? | [Assess impact](how-to-assess-dependency-impact.md) |
| What rules apply to changes? | [Agent rules](../AGENTS.md) |
| What does each terminal view show? | [Screens](screens.md) |

## Conventions

- New documentation is in English and lives in this directory.
- Planning documents distinguish proposed work from implemented behaviour.
- User guides use actual output from the program and state their prerequisites.
- The CLI reference will be generated from implemented command definitions.
- Links in this map point only to pages that currently exist.
