# Repeat a read query

**The question:** How do I run a selected-column OData read with explicit
coverage and a repeatable filter?

This page needs [table discovery](how-to-discover-tables.md) and an application
user permitted to read the selected records.

## Before you start

Install the [local candidate](../README.md#install). Logical names below are examples; inspect
your environment first. SQL is not exposed: its supported syntax and
pagination have not been verified in a development environment.

## Steps

1. Put your explicit OData filter expression in a local file. For a synthetic
   account example, the contents of `filter.txt` are:

   ```text
   name eq 'Synthetic Account'
   ```

2. Run the read using explicit columns and deterministic ordering:

   ```sh
   unverse query --env dev --table account --select accountid,name --filter-file filter.txt --order-by "accountid asc" --limit 100 --json
   ```

   Offline tests observed that `account` resolves to entity set `accounts`,
   selected columns and filter text survive URL encoding, and a two-row
   fixture capped to one row returns `coverage.complete: false`, status
   `inconclusive`, and exit 7. The authorized DEV query read only the account
   primary key and returned zero rows with complete coverage. Because the
   collection was empty, it did not exercise continuation. A subsequent
   authorized `systemuser` query selected only IDs, read two rows across at
   least two data pages, and logged no IDs or row contents.

3. Remove `--limit` to request all pages. Exit 0 means all requested pages
   completed. A later-page failure returns its error and incomplete coverage,
   not a complete partial result. Record reads are not a transactional
   snapshot; data can change between pages.

## What can go wrong

`--select` and `--table` are required. Column and table names must be logical
identifiers. Ordering accepts column names with optional `asc` or `desc`.
Filters are explicit operator-provided expressions, not an arbitrary SQL or
JavaScript execution facility. The server validates the filter expression.

Row caps do not establish counts of all matching records. Permission errors
do not prove absence. Cross-origin continuation links and redirects are
rejected. Retry is bounded and respects service instructions; exhausted
failures exit 5.

## Next

Use [the result contract](design.md#8-results-and-exits) to consume JSON in CI.
