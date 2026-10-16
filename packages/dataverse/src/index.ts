export {
  type Credential,
  DataverseClient,
  DataverseError,
  type HttpResponse,
  type HttpTransport,
  type RetryClock,
  type WhoAmI,
} from "./client.js";
export {
  connectionReferences,
  connectors,
} from "./connections.js";
export {
  applyDataPlan,
  type DataPlan,
  planDataverseTransfer,
  planSeed,
} from "./data-plan.js";
export { type DependencyOptions, dependencyGraph } from "./dependencies.js";
export {
  apps,
  compareEnvironments,
  flows,
  type Resource,
  solutionComponents,
  solutions,
  users,
  variables,
} from "./discovery.js";
export { type QueryOptions, query, type Table, tables } from "./query.js";
export {
  resolveRole,
  type UserRoles,
  type UserSelector,
  userRoles,
} from "./roles.js";
export { applySchema, inspectSchema } from "./schema.js";
export { exportTransfer } from "./transfer.js";
