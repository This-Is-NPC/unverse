# Inspect connectors and connection references

**The question:** Which solution-aware connectors and connection bindings are
visible in the selected environment?

This page needs [a connected environment](how-to-connect-an-environment.md).
It does not create, repair, reauthenticate, share, or change a connection.

## Before you start

A connector describes an API. A connection is an authenticated instance of
that connector. A connection reference is a solution component that points
to a connection. The application user needs read access to the corresponding
Dataverse metadata. This is not the complete Power Platform connector catalog.

## Steps

1. Find connector and reference metadata:

   ```sh
   unverse connectors list --env dev --search example --json
   unverse connection-references list --env dev --search example --json
   ```

   The installed synthetic fixture returned one custom connector and one
   reference. The reference was `linked: true` with `health: "not-checked"`.
   Neither active metadata state nor a non-empty connection ID proves that
   credentials work or that a flow owner can use that connection.

2. Optionally restrict either list using `--solution-id`. Use the ID from
   [solution discovery](how-to-discover-resources.md), not one copied from
   another environment. This filters by visible solution component membership.

3. Inspect one reference; the GUID is a placeholder:

   ```sh
   unverse connection-references inspect --env dev --reference-id 00000000-0000-0000-0000-000000000101 --json
   ```

   The fixture reported logical name `uv_example_reference`, a connector API
   identifier, an opaque connection ID, and an optional custom-connector ID.
   Credential parameters, OpenAPI definitions, custom code, and connection
   parameter configurations are not retrieved. Inspection requires the explicit
   reference ID; absent or ambiguous results are not presented as a found item.

## What can go wrong

Denied inventory fails rather than becoming an empty list. The inventory does
not check connection health, sharing, effective permissions, DLP, or actual
consumers. A reference with no observed usage is not necessarily unused.
Connection IDs and names can still identify organizational resources; keep
exports private. Connections and the broader connector catalog require a
separate management API/authentication boundary, not reuse of a Dataverse token.

## Next

[Explore dependencies](how-to-explore-dependencies.md) or
[trace potential impact](how-to-assess-dependency-impact.md).
