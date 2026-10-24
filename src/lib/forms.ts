import { z } from "zod";

export const formFieldTypeSchema = z.enum([
  "text",
  "email",
  "url",
  "number",
  "currency",
  "boolean",
  "date",
  "datetime",
  "textarea",
  "select",
  "multiSelect",
  "hidden",
  "readonly",
]);

export type FormFieldType = z.infer<typeof formFieldTypeSchema>;

export interface FormOption {
  label: string;
  value: string;
}

export interface FormFieldDefinition {
  key: string;
  label: string;
  type: FormFieldType;
  required?: boolean;
  helpText?: string;
  placeholder?: string;
  options?: FormOption[];
  defaultValue?: unknown;
}

export interface FormDefinition {
  fields: FormFieldDefinition[];
}

export const emptyForm: FormDefinition = { fields: [] };
