import { AppError, msg } from "./messages.js";
import { findOperation, resolveRef, type OpenApiDoc } from "./openapi.js";

type Json = Record<string, unknown>;
const encoder = new TextEncoder();
export const INPUT_BYTES = 64 * 1024;

/** Bound work before stringification, reference traversal, logging or I/O. */
export function assertInputBounds(value: unknown): void {
  let bytes = 0;
  const seen = new Set<object>();
  function visit(v: unknown, depth: number): void {
    if (depth > 16) throw new AppError(msg("config.requestTooLarge"));
    if (typeof v === "string") bytes += encoder.encode(v).byteLength;
    else if (v && typeof v === "object") {
      if (seen.has(v)) throw new AppError(msg("config.requestTooLarge"));
      seen.add(v);
      const entries = Object.entries(v);
      if (entries.length > (Array.isArray(v) ? 1000 : 200)) throw new AppError(msg("config.requestTooLarge"));
      for (const [key, item] of entries) { bytes += encoder.encode(key).byteLength + 4; visit(item, depth + 1); }
      seen.delete(v);
    } else bytes += 16;
    if (bytes > INPUT_BYTES) throw new AppError(msg("config.requestTooLarge"));
  }
  visit(value, 0);
}

function object(v: unknown): Json | null {
  return v && typeof v === "object" && !Array.isArray(v) ? v as Json : null;
}

const SCHEMA_KEYS = new Set(["type", "anyOf", "oneOf", "allOf", "nullable", "enum", "const", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "items", "minItems", "maxItems", "uniqueItems", "properties", "required", "additionalProperties", "format", "title", "description", "default", "example", "examples", "deprecated", "readOnly", "writeOnly", "$schema", "$id", "$defs", "definitions"]);

function contract(value: unknown): Json | boolean {
  return typeof value === "boolean" ? value : object(value) ?? false;
}

/** Conservative validation for supported JSON Schema/OpenAPI input contracts. */
function matches(value: unknown, schema: Json | boolean, coerce: boolean, depth = 0): boolean {
  if (typeof schema === "boolean") return schema;
  if (depth > 16 || Object.keys(schema).some((k) => !SCHEMA_KEYS.has(k) && !k.startsWith("x-")) || schema.readOnly === true || schema.writeOnly === true) return false;
  const branch = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(branch)) {
    const n = branch.filter((s) => matches(value, contract(s), coerce, depth + 1)).length;
    if (schema.oneOf ? n !== 1 : n === 0) return false;
  }
  if (Array.isArray(schema.allOf) && !schema.allOf.every((s) => matches(value, contract(s), coerce, depth + 1))) return false;
  if (value === null) return schema.type === "null" || (Array.isArray(schema.type) && schema.type.includes("null")) || schema.nullable === true || Array.isArray(branch);
  let v = value;
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (coerce && typeof v === "string") {
    if (types.includes("integer") && !types.includes("number") && /^-?\d+$/.test(v)) v = Number(v);
    else if (types.includes("number") && /^-?(?:\d+\.?\d*|\.\d+)$/.test(v)) v = Number(v);
    else if (types.includes("boolean") && ["true", "false"].includes(v)) v = v === "true";
    // Query arrays must be actual arrays so URL serialization repeats the key.
    // The UI parses its array editor; do not validate one encoding and send another.
  }
  if (types.length && !types.some((t) => {
    if (t === "array") return Array.isArray(v);
    if (t === "object") return object(v) !== null;
    if (t === "integer") return typeof v === "number" && Number.isSafeInteger(v);
    if (t === "number") return typeof v === "number" && Number.isFinite(v);
    return typeof v === t;
  })) return false;
  if (Array.isArray(schema.enum) && !schema.enum.some((x) => JSON.stringify(x) === JSON.stringify(v))) return false;
  if (schema.const !== undefined && JSON.stringify(v) !== JSON.stringify(schema.const)) return false;
  if (typeof v === "number") {
    if (typeof schema.minimum === "number" && v < schema.minimum) return false;
    if (typeof schema.maximum === "number" && v > schema.maximum) return false;
    if (typeof schema.exclusiveMinimum === "number" && v <= schema.exclusiveMinimum) return false;
    if (typeof schema.exclusiveMaximum === "number" && v >= schema.exclusiveMaximum) return false;
    if (typeof schema.multipleOf === "number" && !Number.isInteger(v / schema.multipleOf)) return false;
  }
  if (typeof v === "string") {
    if (typeof schema.minLength === "number" && v.length < schema.minLength) return false;
    if (typeof schema.maxLength === "number" && v.length > schema.maxLength) return false;
    if (schema.format !== undefined) {
      switch (schema.format) {
        case "date": if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString().slice(0, 10) !== v) return false; break;
        case "date-time": if (!/^\d{4}-\d{2}-\d{2}T/.test(v) || !Number.isFinite(Date.parse(v))) return false; break;
        case "uri": case "url": try { new URL(v); } catch { return false; } break;
        case "uuid": if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v)) return false; break;
        case "email": if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return false; break;
        default: return false;
      }
    }
  }
  if (Array.isArray(v)) {
    if (typeof schema.minItems === "number" && v.length < schema.minItems) return false;
    if (typeof schema.maxItems === "number" && v.length > schema.maxItems) return false;
    if (schema.uniqueItems === true && new Set(v.map((x) => JSON.stringify(x))).size !== v.length) return false;
    if (schema.items !== undefined && !v.every((x) => matches(x, contract(schema.items), false, depth + 1))) return false;
  }
  const record = object(v);
  if (record) {
    const props = object(schema.properties) ?? {};
    if (Array.isArray(schema.required) && schema.required.some((k) => typeof k === "string" && record[k] === undefined)) return false;
    for (const [k, item] of Object.entries(record)) {
      if (Object.hasOwn(props, k) && !matches(item, contract(props[k]), false, depth + 1)) return false;
      if (!Object.hasOwn(props, k) && schema.additionalProperties === false) return false;
      if (!Object.hasOwn(props, k) && schema.additionalProperties !== undefined && !matches(item, contract(schema.additionalProperties), false, depth + 1)) return false;
    }
  }
  return true;
}

export function validateRequest(doc: OpenApiDoc, method: string, path: string, query: Json, pathParams: Json, body: unknown): string[] {
  const raw = findOperation(doc, method, path);
  if (!raw) return ["contract"];
  const op = resolveRef(doc, raw) as Json;
  const parameters = [...(Array.isArray(doc.paths[path]?.parameters) ? doc.paths[path]!.parameters : []), ...(Array.isArray(op.parameters) ? op.parameters : [])] as unknown[];
  const issues: string[] = [];
  const names = new Set<string>();
  for (const rawParam of parameters) {
    const p = object(resolveRef(doc, rawParam));
    if (!p || typeof p.name !== "string") { issues.push("contract"); continue; }
    if (!["query", "path"].includes(String(p.in))) { issues.push("unsupported parameter location"); continue; }
    names.add(String(p.in) + ":" + p.name);
    const value = (p.in === "path" ? pathParams : query)[p.name];
    if (value === undefined || value === null || value === "") {
      if (p.required) issues.push(p.name);
    } else if (!matches(value, contract(p.schema ?? {}), true)) issues.push(p.name);
  }
  for (const k of Object.keys(query)) if (!names.has("query:" + k)) issues.push("query." + k);
  for (const k of Object.keys(pathParams)) if (!names.has("path:" + k)) issues.push("path." + k);
  const rb = object(op.requestBody);
  if (rb) {
    const content = object(rb.content);
    const media = object(content?.["application/json"]);
    if (!media) issues.push("unsupported content type");
    else if (body === undefined) {
      if (rb.required || (Array.isArray(object(media.schema)?.required) && (object(media.schema)!.required as unknown[]).length > 0)) issues.push("body");
    } else if (!matches(body, contract(media.schema ?? {}), false)) issues.push("body");
  } else if (body !== undefined) issues.push("unexpected body");
  return [...new Set(issues)].slice(0, 20);
}
