import type { Result } from "@unverse/core";

export function renderCsv(result: Result<unknown>): string {
  const data = result.data;
  const arrays =
    data !== null && typeof data === "object" && !Array.isArray(data)
      ? Object.values(data).filter(Array.isArray)
      : [];
  const rows: readonly unknown[] = Array.isArray(data)
    ? data
    : arrays.length === 1
      ? (arrays[0] ?? [])
      : [data];
  const records = rows.map((row) => ({
    command: result.command,
    status: result.status,
    environment: result.environment?.name ?? "",
    ...(row !== null && typeof row === "object" && !Array.isArray(row)
      ? row
      : { value: row }),
  }));
  const headers = [
    ...new Set([
      "command",
      "status",
      "environment",
      ...records.flatMap(Object.keys),
    ]),
  ];
  return `${[headers, ...records.map((row) => headers.map((key) => (row as Record<string, unknown>)[key]))].map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`;
}

function cell(value: unknown): string {
  let text =
    value === undefined || value === null
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  if (/^[\s]*[=+\-@]|^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
