// Copy to .unverse/pipelines/families.mjs in your project.
export default {
  description: "Create synthetic parent rows, each with one child row.",
  params: [
    {
      name: "--count",
      value: "rows",
      summary: "How many parent rows to create.",
      required: true,
      choices: ["1", "2", "3"],
    },
    {
      name: "--namespace",
      value: "name",
      summary: "Seed namespace the row IDs derive from (default families).",
    },
  ],
  async run(ctx) {
    const namespace = ctx.params.namespace ?? "families";
    const rows = { parent: [], child: [] };
    for (let number = 1; number <= Number(ctx.params.count); number += 1) {
      const id = await ctx.seedId(namespace, "parent", `family-${number}`);
      rows.parent.push({
        id,
        name: `Family ${number}`,
        amount: "10.00",
        count: number,
        enabled: true,
        day: "2026-10-17",
        instant: "2026-10-17T12:00:00Z",
      });
      rows.child.push({
        id: await ctx.seedId(namespace, "child", `child-${number}`),
        name: `Child ${number}`,
        parentid: id,
      });
    }
    return {
      model: await ctx.readJson("schema.json"),
      mapping: await ctx.readJson("transfer-mapping.json"),
      data: rows,
    };
  },
};
