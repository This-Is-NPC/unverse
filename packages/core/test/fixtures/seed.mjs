export function seedSpec(
  model,
  mapping,
  data,
  namespace = "community-fixture",
) {
  const keys = new Map(
    model.entities.map((entity) => [
      entity.name,
      new Map(
        data[entity.name].map((row, index) => [
          row[entity.primaryKey],
          `row-${index}`,
        ]),
      ),
    ]),
  );
  return {
    seedVersion: 1,
    seed: namespace,
    model,
    mapping,
    rows: Object.fromEntries(
      model.entities.map((entity) => [
        entity.name,
        data[entity.name].map((row, index) => ({
          key: `row-${index}`,
          values: Object.fromEntries(
            entity.columns
              .filter((column) => column.name !== entity.primaryKey)
              .map((column) => [
                column.name,
                column.references !== undefined && row[column.name] !== null
                  ? { key: keys.get(column.references).get(row[column.name]) }
                  : row[column.name],
              ]),
          ),
        })),
      ]),
    ),
  };
}
