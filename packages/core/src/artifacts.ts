export const artifactSources = ["dataverse"] as const;
export type ArtifactSource = (typeof artifactSources)[number];

export const artifactFields = [
  "displayName",
  "solution",
  "publisher",
  "owner",
  "managed",
  "kind",
] as const;
export type ArtifactField = (typeof artifactFields)[number];

export interface ArtifactItem {
  readonly type: string;
  readonly id: string;
  readonly name: string;
  readonly displayName?: string;
  readonly solution?: string;
  readonly publisher?: string;
  readonly owner?: string;
  readonly managed?: boolean;
  readonly kind?: string;
  readonly source: ArtifactSource;
}

export interface ArtifactAbsence {
  readonly field: ArtifactField;
  readonly reason: string;
}

export interface ArtifactTypeSpec {
  readonly type: string;
  readonly summary: string;
  readonly platformName: string;
  readonly sources: readonly ArtifactSource[];
  readonly idKind: "guid" | "logical-name";
  readonly fields: readonly ArtifactField[];
  readonly absent: readonly ArtifactAbsence[];
  readonly componentType?: number;
}

const membership =
  "The inventory does not read solution membership; a declared type that needs it reads it once.";
const publisherJoin =
  "The publisher comes from the owning solution; the inventory does not read it.";
const unmappedMembership =
  "The solution component type of this type is not mapped, so membership is not read.";
const notRead = "The reader does not select this column.";

export const artifactCatalog = [
  {
    type: "table",
    summary: "Dataverse tables (entity definitions).",
    platformName: "EntityDefinitions",
    sources: ["dataverse"],
    idKind: "logical-name",
    fields: ["displayName"],
    absent: [
      { field: "solution", reason: membership },
      { field: "publisher", reason: publisherJoin },
      { field: "owner", reason: "Tables are metadata and have no owner." },
      { field: "managed", reason: notRead },
      { field: "kind", reason: "Tables have no subtype in this catalog." },
    ],
    componentType: 1,
  },
  {
    type: "canvas-app",
    summary:
      "Canvas apps, including code apps, component libraries, and custom pages.",
    platformName: "canvasapps",
    sources: ["dataverse"],
    idKind: "guid",
    fields: ["displayName", "owner", "managed", "kind"],
    absent: [
      { field: "solution", reason: membership },
      {
        field: "publisher",
        reason:
          "The canvasapps publisher column is free text from the app, not a Dataverse publisher.",
      },
    ],
    componentType: 300,
  },
  {
    type: "model-driven-app",
    summary: "Model-driven apps.",
    platformName: "appmodules",
    sources: ["dataverse"],
    idKind: "guid",
    fields: ["displayName"],
    absent: [
      { field: "solution", reason: membership },
      { field: "publisher", reason: publisherJoin },
      { field: "owner", reason: notRead },
      { field: "managed", reason: notRead },
      {
        field: "kind",
        reason: "Model-driven apps have no subtype in this catalog.",
      },
    ],
    componentType: 80,
  },
  {
    type: "cloud-flow",
    summary: "Cloud flows (workflows of category 5).",
    platformName: "workflows",
    sources: ["dataverse"],
    idKind: "guid",
    fields: ["displayName", "owner", "managed"],
    absent: [
      { field: "solution", reason: membership },
      { field: "publisher", reason: publisherJoin },
      { field: "kind", reason: "Cloud flows have no subtype in this catalog." },
    ],
    componentType: 29,
  },
  {
    type: "security-role",
    summary: "Security roles.",
    platformName: "roles",
    sources: ["dataverse"],
    idKind: "guid",
    fields: ["managed"],
    absent: [
      {
        field: "displayName",
        reason: "Roles have one name and no display name.",
      },
      { field: "solution", reason: membership },
      { field: "publisher", reason: publisherJoin },
      {
        field: "owner",
        reason: "Roles belong to a business unit, not to an owner.",
      },
      { field: "kind", reason: "Roles have no subtype." },
    ],
    componentType: 20,
  },
  {
    type: "connection-reference",
    summary: "Connection references.",
    platformName: "connectionreferences",
    sources: ["dataverse"],
    idKind: "guid",
    fields: ["displayName", "managed"],
    absent: [
      { field: "solution", reason: unmappedMembership },
      { field: "publisher", reason: unmappedMembership },
      { field: "owner", reason: notRead },
      { field: "kind", reason: "Connection references have no subtype." },
    ],
  },
  {
    type: "environment-variable",
    summary: "Environment variable definitions; values are never read.",
    platformName: "environmentvariabledefinitions",
    sources: ["dataverse"],
    idKind: "guid",
    fields: ["displayName", "managed"],
    absent: [
      { field: "solution", reason: membership },
      { field: "publisher", reason: publisherJoin },
      { field: "owner", reason: notRead },
      {
        field: "kind",
        reason: "Variable types are data types, not artifact subtypes.",
      },
    ],
    componentType: 380,
  },
  {
    type: "solution",
    summary: "Solutions.",
    platformName: "solutions",
    sources: ["dataverse"],
    idKind: "guid",
    fields: ["displayName", "managed"],
    absent: [
      {
        field: "solution",
        reason: "A solution is not a member of a solution.",
      },
      {
        field: "publisher",
        reason:
          "The publisher needs an expand on the solution read; the inventory does not make it.",
      },
      { field: "owner", reason: "Solutions have no owner." },
      { field: "kind", reason: "Solutions have no subtype in this catalog." },
    ],
  },
  {
    type: "connector",
    summary: "Connectors stored in the environment.",
    platformName: "connectors",
    sources: ["dataverse"],
    idKind: "guid",
    fields: ["displayName", "managed"],
    absent: [
      { field: "solution", reason: unmappedMembership },
      { field: "publisher", reason: unmappedMembership },
      { field: "owner", reason: notRead },
      {
        field: "kind",
        reason:
          "The connector type is a numeric code, not mapped to a subtype.",
      },
    ],
  },
] as const satisfies readonly ArtifactTypeSpec[];

export type ArtifactTypeName = (typeof artifactCatalog)[number]["type"];

export const artifactTypeNames: readonly ArtifactTypeName[] =
  artifactCatalog.map((entry) => entry.type);

export function findArtifactType(name: string): ArtifactTypeSpec | undefined {
  return artifactCatalog.find((entry) => entry.type === name);
}
