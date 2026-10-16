# Export command results as CSV

**The question:** How do I review results in a spreadsheet without writing
an exporter for each command?

This page is enough once the candidate is installed and the selected
environment is configured.

## Before you start

Choose `--csv` or `--json`, not both. Standard output contains only the selected
format. Error messages go to standard error in CSV mode; check the exit code
before consuming a file. User, row, and manifest exports can contain personal
or business data even though variable values are masked.

## Steps

1. Export visible apps; the output filename is a placeholder:

   ```sh
   unverse apps list --env dev --csv > apps.csv
   ```

   The installed fixture starts with `"command","status","environment"`,
   followed by the resource fields. Every cell is quoted; quotes are doubled
   and records use CRLF. Nested objects and arrays remain JSON inside a cell.

2. Check the command's exit and inspect the file. A top-level resource array
   produces one record per resource. A result containing exactly one array
   expands that array. Other results use one record with nested JSON cells.
   An empty list still emits headers. CSV is a review format, not a replacement
   for a canonical JSON plan or manifest.

## What can go wrong

Cells beginning with spreadsheet formula prefixes, including after whitespace,
are prefixed with an apostrophe. This changes their displayed text deliberately;
use JSON for lossless machine-to-machine exchange. Spreadsheet applications
can still reformat numbers and dates. The format does not remove personal data.

Do not feed CSV back into schema or data apply. They accept the reviewed JSON
artifacts, whose integrity checks CSV cannot preserve.

## Next

[Discover resources](how-to-discover-resources.md) or
[compare environment settings](how-to-compare-environments.md).
