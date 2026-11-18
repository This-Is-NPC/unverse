import { PlatformClient } from "../../dist/index.js";

export const environmentId = "11111111-2222-3333-4444-555555555555";
const base = "https://api.powerplatform.com";
const appId = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

export const appsFirstPage = {
  value: [
    {
      id: `/providers/Microsoft.PowerApps/apps/${appId(2)}`,
      name: appId(2),
      type: "Microsoft.PowerApps/apps",
      properties: { displayName: "Zeta Canvas", description: "ignored" },
    },
  ],
  nextLink: `${base}/powerapps/environments/${environmentId}/apps?api-version=2024-10-01&$skiptoken=page2`,
};
export const appsLastPage = {
  value: [{ name: appId(1), properties: { displayName: "Alpha Canvas" } }],
};
export const flowsPage = {
  value: [
    {
      workflowId: appId(7),
      name: "Example Flow",
      uniqueName: "flow_internal",
      stateCode: 1,
    },
    { workflowId: appId(8), name: "Bare Flow" },
  ],
};

/** Serves documented Power Platform API shapes; `routes` maps a path prefix to pages. */
export function platformFixture({ routes, status = {}, token } = {}) {
  const requests = [];
  const tokens = [];
  const served = {};
  const transport = {
    get: async (url, headers) => {
      requests.push({ url, headers });
      const path = new URL(url).pathname;
      const code = status[path] ?? 200;
      if (code !== 200)
        return {
          status: code,
          headers: {},
          body: JSON.stringify({
            error: { code: "Forbidden", message: "Caller lacks a role." },
          }),
        };
      const pages = routes[path] ?? [];
      const index = served[path] ?? 0;
      served[path] = index + 1;
      return {
        status: 200,
        headers: {},
        body: JSON.stringify(pages[index] ?? { value: [] }),
      };
    },
  };
  const client = new PlatformClient(
    environmentId,
    {
      getToken: async (scope) => {
        tokens.push(scope);
        return token ?? "platform-token";
      },
    },
    transport,
    { now: () => 0, wait: async () => {} },
  );
  return { client, requests, tokens };
}

export const appsPath = `/powerapps/environments/${environmentId}/apps`;
export const flowsPath = `/powerautomate/environments/${environmentId}/cloudFlows`;
