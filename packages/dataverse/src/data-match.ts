import { canonical, type Dataset, type SchemaModel } from "@unverse/core";

type Row = Readonly<Record<string, unknown>>;

export interface KeyMatch {
  readonly entity: string;
  readonly id: string;
  readonly targetId: string;
  readonly key: string;
}

export interface DesiredRows {
  /** Desired rows with matched IDs and references repointed to the target. */
  readonly rows: Readonly<Record<string, readonly Row[]>>;
  readonly matched: readonly KeyMatch[];
  readonly ambiguous: readonly {
    readonly entity: string;
    readonly id: string;
    readonly reason: string;
  }[];
}

/**
 * Finds, for each desired row whose ID is absent in the target, the target row
 * with the same alternate key tuple. Keys are tried in declaration order and
 * the first key with a hit wins; a target row another desired row already
 * claims leaves the desired row ambiguous (the target export already rejects
 * two rows with one key tuple). Lookup columns of a key follow the
 * matches already found, so passes repeat until no match is added.
 */
export function matchByKeys(
  model: SchemaModel,
  desired: Dataset,
  target: Dataset,
): DesiredRows {
  const repoint = new Map<string, string>();
  const matched: KeyMatch[] = [];
  const ambiguous = new Map<string, string>();
  const claimed = new Set<string>();
  const slot = (entity: string, id: unknown) => `${entity}/${String(id)}`;
  for (const entity of model.entities) {
    const present = new Set(
      (target[entity.name] ?? []).map((row) => String(row[entity.primaryKey])),
    );
    for (const row of desired[entity.name] ?? []) {
      const id = String(row[entity.primaryKey]);
      if (present.has(id)) claimed.add(slot(entity.name, id));
    }
  }
  const follow = (references: string | undefined, value: unknown) =>
    references === undefined
      ? value
      : (repoint.get(slot(references, value)) ?? value);
  for (let added = true; added; ) {
    added = false;
    for (const entity of model.entities) {
      const targetRows = target[entity.name] ?? [];
      const present = new Set(
        targetRows.map((row) => String(row[entity.primaryKey])),
      );
      for (const row of desired[entity.name] ?? []) {
        const id = String(row[entity.primaryKey]);
        const own = slot(entity.name, id);
        if (present.has(id) || repoint.has(own) || ambiguous.has(own)) continue;
        for (const key of entity.keys ?? []) {
          const tuple = key.columns.map((name) =>
            follow(
              entity.columns.find((column) => column.name === name)?.references,
              row[name],
            ),
          );
          if (tuple.some((value) => value === null)) continue;
          const hit = targetRows.find(
            (candidate) =>
              canonical(key.columns.map((name) => candidate[name])) ===
              canonical(tuple),
          );
          if (hit === undefined) continue;
          const targetId = String(hit[entity.primaryKey]);
          if (claimed.has(slot(entity.name, targetId)))
            ambiguous.set(
              own,
              `The target row with the key ${key.name} belongs to another desired row.`,
            );
          else {
            repoint.set(own, targetId);
            claimed.add(slot(entity.name, targetId));
            matched.push({ entity: entity.name, id, targetId, key: key.name });
            added = true;
          }
          break;
        }
      }
    }
  }
  const rows = Object.fromEntries(
    model.entities.map((entity) => [
      entity.name,
      (desired[entity.name] ?? [])
        .filter(
          (row) => !ambiguous.has(slot(entity.name, row[entity.primaryKey])),
        )
        .map((row) =>
          Object.fromEntries(
            entity.columns.map((column) => [
              column.name,
              column.name === entity.primaryKey
                ? (repoint.get(slot(entity.name, row[column.name])) ??
                  row[column.name])
                : follow(column.references, row[column.name]),
            ]),
          ),
        ),
    ]),
  );
  return {
    rows,
    matched,
    ambiguous: [...ambiguous].map(([own, reason]) => ({
      entity: own.slice(0, own.indexOf("/")),
      id: own.slice(own.indexOf("/") + 1),
      reason,
    })),
  };
}
