# Discover a table

**The question:** What logical name, entity set, and primary key does a
Dataverse table expose?

This page needs [a connected environment](how-to-connect-an-environment.md).

## Before you start

`--search` matches logical names, localized display labels, and entity sets
case-insensitively. It remains a local metadata search, not an unsupported
server-side `contains` expression.

Install the [local candidate](../README.md#install) and give the application user permission to
read the relevant metadata. Metadata visibility is not record access. The
`account` search below is a built-in table example, not a promise of access.

## Steps

1. Search logical names:

   ```sh
   unverse tables list --env dev --search account --json
   ```

   Synthetic metadata tests returned the logical name `account`, entity set
   `accounts`, primary key `accountid`, display name `Account`, and
   `intersect: false`. The authorized DEV check also observed that `account`
   exposes an entity set and primary key without logging environment values.

2. Inspect `data.tables` and `coverage`. The command reads all metadata pages;
   it does not guess an entity set by pluralizing the logical name. Missing
   localized labels and entity sets remain null rather than invented values.
   Search is a case-insensitive local substring match after metadata retrieval;
   Dataverse metadata entities do not support the `contains` function used
   for ordinary record filtering.

## What can go wrong

Missing metadata permissions produce an error. A failed later page does not
appear as a complete list. A table without a queryable entity set cannot be
queried by the current OData command. Continuation URLs outside the selected
Dataverse API are rejected before a bearer token is sent.

## Next

[Repeat a read query](how-to-query-records.md) against the resolved table.
