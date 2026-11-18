import { outputVersion, parseMapping, record } from "@unverse/core";

type ReadFile = (path: string) => Promise<string>;

function unwrap(input: Record<string, unknown>): unknown {
  return input.outputVersion === outputVersion ? input.data : input;
}

export async function readDocument(
  readFile: ReadFile,
  path: string,
): Promise<unknown> {
  return unwrap(record(JSON.parse(await readFile(path))));
}

export async function readMapping(readFile: ReadFile, path: string) {
  return parseMapping(JSON.parse(await readFile(path)));
}
