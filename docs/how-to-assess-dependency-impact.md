# Trace potential artifact impact

**The question:** Which observed consumers should I review before changing
this artifact or connection reference?

This page requires [a dependency scope](how-to-explore-dependencies.md).
It is not a runtime failure predictor or a safe-delete command.

## Before you start

Identify one reference or an underlying component type/ID pair. Unlike graph,
impact does not accept a whole solution as its root. It always follows
dependents, not requirements, and never calls a delete or update operation.

## Steps

1. Trace consumers; the GUID is a placeholder:

   ```sh
   unverse dependencies impact --env dev --reference-id 00000000-0000-0000-0000-000000000101 --depth 6 --json
   ```

   The installed fixture returned four potentially affected components,
   including a canvas app through a flow. Every affected node includes a
   shortest observed path from the root and its hop distance. This is a
   potential impact path, not a claim that changing the root will break it.

2. Inspect `data.analysis.cycles` and the paths. Cycles are strongly connected
   groups in the observed non-membership graph; they do not cause infinite
   traversal or duplicate impact rows. Solution membership is excluded from
   impact paths, so merely sharing a solution does not imply impact.

3. Add `--html`, `--mermaid`, or `--svg` for a visual projection using the same graph and
   coverage rules. Return to JSON for full path and issue records.

## What can go wrong

A bounded or denied investigation returns an incomplete result, not a finding
that the artifact has no consumers. An empty result for an unverified object
is also incomplete. Inspect `issues`, `frontier`, and `coverage` before drawing
conclusions. Zero declared consumers never proves complete absence of runtime
usage, including dynamic references and systems outside Dataverse solutions.

Published, unpublished, and solution-internal dependency types are retained as
reported by Dataverse. This command does not substitute for the platform's
specific delete/uninstall dependency checks, which are not implemented here.
Do not automatically remove apparently unused references or connections.

## Next

Review the affected artifacts with their owners. See
[design §17](design.md#17-dependency-evidence-and-visualization) for identities,
evidence sources, safety boundaries, and the official API references.
