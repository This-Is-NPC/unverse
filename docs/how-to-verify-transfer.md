# Verify a committed transfer

**The question:** Do PostgreSQL rows and definitions still satisfy the
manifest's declared invariants?

This page requires [an imported manifest](how-to-import-data.md).

## Before you start

Use the same selected source profile, immutable manifest, and target schema.
PostgreSQL verification does not acquire a Dataverse token or contact the
source environment.

## Steps

1. Run read-only verification:

   ```sh
   unverse transfer verify --env dev --manifest-file manifest.json --json
   ```

   Synthetic integration tests observed `verified: true` for matching data,
   and detected altered decimal column precision even when values themselves
   still looked equivalent.

2. Check both the exit and `data.verified`. Differences identify counts,
   identity maps, relationships, decimal values, temporal values, or target
   definitions. A completed failed comparison exits 1; a service failure is
   not a completed comparison and remains an error.

## What can go wrong

The manifest fingerprint is not a signature or an authorization mechanism.
Review files and target profiles before use. A trusted database role can
modify both data and checkpoints; verification is not tamper-proof auditing.
The report names workflows and access policies as outside the transfer.
Independent read-only verification is not a multi-table transaction snapshot;
avoid concurrent modifications while interpreting its results.

## Next

Review [transfer semantics](design.md#15-transfer-contract-and-postgresql)
before deciding whether the declared subset is sufficient for an application.
