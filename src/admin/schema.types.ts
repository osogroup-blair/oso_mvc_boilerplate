// The vocabulary for schema-driven admin pages.
// A model's admin UI is fully described by an AdminSchema — the ONE template
// renders any object by walking these field definitions.
// See skills/SKILL-admin.md.

import type { AdminResourceAdapter } from "./resource.types.js";

export type FieldType =
  | "text"
  | "password"
  | "email"
  | "url"
  | "number"
  | "boolean"
  | "date"
  | "datetime"
  | "textarea"
  | "select"
  | "object" // single nested sub-object (e.g. address)
  | "array" // list — see itemType
  | "relation" // single reference to another model (searchable dropdown)
  | "multiRelation"; // multi-select reference to another model (checkbox list)

export interface RelationOption {
  id: string;
  label: string;
}

export interface FieldDef {
  key: string;
  label?: string; // defaults to a humanized key
  type: FieldType;
  readonly?: boolean;
  required?: boolean;
  help?: string;

  // type: "select"
  options?: string[];

  // type: "object" | array of objects
  fields?: FieldDef[];

  // type: "array"
  itemType?: "text" | "number" | "object";

  // type: "relation" | "multiRelation"
  relation?: {
    model: string; // target admin model key, e.g. "role"
    labelField: string; // which field to show as the option label
  };

  // type: "multiRelation" — same shape as relation, multi-select
  multiRelation?: {
    model: string;
    labelField: string;
  };
}

export interface AdminSchema {
  // model key used in the URL: /admin/:model
  key: string;
  label: string; // singular display, e.g. "User"
  labelPlural: string; // e.g. "Users"
  // columns shown in the list view (subset of field keys)
  listColumns: string[];
  category: "system" | "application";
  fields: FieldDef[];
  fieldsForRecord?: (record: Record<string, unknown>) => FieldDef[];
  adapter?: AdminResourceAdapter;
  
  // Optional callback to determine if a specific record is read-only
  isRecordReadonly?: (record: any) => boolean;
}

// Options for a relation field are pre-fetched by the controller and injected
// into the payload keyed by the field's `key`. The view NEVER queries the DB.
export type RelationOptionsMap = Record<string, RelationOption[]>;
