import { DataverseClient } from "../../dist/index.js";

export const table = {
  LogicalName: "account",
  EntitySetName: "accounts",
  PrimaryIdAttribute: "accountid",
  DisplayName: { UserLocalizedLabel: { Label: "Account" } },
  IsIntersect: false,
};

export function queryFixture(options = {}) {
  const calls = [];
  const client = new DataverseClient(
    "https://dev.crm.dynamics.com",
    { getToken: async () => "fixture-token" },
    {
      get: async (value) => {
        calls.push(value);
        const url = new URL(value);
        let body;
        if (url.pathname.endsWith("/WhoAmI"))
          body = {
            OrganizationId: "org",
            UserId: "app",
            BusinessUnitId: "unit",
          };
        else if (
          url.pathname.endsWith("/EntityDefinitions") &&
          url.searchParams.get("$filter")?.includes("contains(")
        )
          return {
            status: 501,
            headers: {},
            body: JSON.stringify({
              error: {
                code: "0x8006088a",
                message:
                  'The "contains" function isn\'t supported for Metadata Entities.',
              },
            }),
          };
        else if (url.pathname.endsWith("/EntityDefinitions"))
          body = { value: options.tables ?? [table] };
        else if (url.pathname.endsWith("/accounts"))
          body = {
            value: options.rows ?? [
              { accountid: "one", name: "Synthetic Account" },
              { accountid: "two", name: "Second Account" },
            ],
          };
        else throw new Error(`Unexpected fixture request: ${value}`);
        return { status: 200, headers: {}, body: JSON.stringify(body) };
      },
    },
    { now: () => 0, wait: async () => {} },
  );
  return { client, calls };
}
