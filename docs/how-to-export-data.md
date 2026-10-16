# Export modeled data

**The question:** How do I produce a reviewable, integrity-checked manifest
for the portable Dataverse subset?

This page requires [an inspected, satisfied schema](how-to-inspect-schema.md).
It is not a general Dataverse backup.

## Before you start

Review the logical model and publisher mapping. The export includes all
modeled rows under those tables, not arbitrary system or business tables.
The application user needs read permissions for every selected field and row.
Keep exported manifests private: they contain IDs and record values.

## Steps

1. Export into a local file. The model path, prefix, solution, and output path
   below are placeholders:

   ```sh
   unverse transfer export --env dev --prefix tx --solution TransferFixture --model-file schema.json --json > manifest.json
   ```

   The installed synthetic fixture exported one parent, one related child,
   preserved UUIDs, a fixed-scale decimal string, a date, and a UTC instant.
   Export first checks that metadata satisfies the model with no pending or
   blocked schema changes.

2. Review `data.model`, `data.source`, `data.policy`, and the row counts in
   `data.data`. `data.fingerprint` binds the canonical model, source identity,
   policy, and values. Do not edit the manifest after review.

## What can go wrong

The export is held in memory and is intended for a bounded modeled dataset.
It is not a transactional snapshot across Dataverse pages. Missing required
values, broken relationships, unknown types, incomplete pages, or lossy
decimal/time conversions fail instead of yielding a valid-looking manifest.
Decimal values are fixed-scale strings. Instants require explicit UTC second
resolution; fractional seconds are rejected, not rounded away. A live fixture
detected a temporal mismatch when fractional input was assumed portable.

No workflows, plugins, policies, auditing, files, or unmodeled fields
are exported. Local single-select choices and bounded multiline text are
supported; global/multiselect choices and external reference datasets are not.
PostgreSQL transfer does not recreate application behaviour.

## Next

[Import the manifest](how-to-import-data.md) into a dedicated PostgreSQL schema.
For a different Dataverse organization, use a reviewed
[field-policy transfer plan](how-to-transfer-dataverse.md).
