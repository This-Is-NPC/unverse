import { DataverseClient } from "../../dist/index.js";
import {
  dependencyEnvironment,
  dependencyTransport,
} from "./dependency-http.mjs";

export * from "./dependency-http.mjs";

export function dependencyFixture(options = {}) {
  const transport = dependencyTransport(options);
  return {
    client: new DataverseClient(
      dependencyEnvironment.url,
      { getToken: async () => "fixture-token" },
      transport,
      { now: () => 0, wait: async () => {} },
    ),
    requests: transport.requests,
  };
}
