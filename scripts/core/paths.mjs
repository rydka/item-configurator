/** Small helpers on plain nested objects and dotted paths (pure, no Foundry global). */

export const isPlain = (value) => value !== null && typeof value === "object" && !Array.isArray(value)
  && !(value instanceof Set) && !(value instanceof Map);

export const clone = (value) => (value === undefined ? value : structuredClone(value));

/** Value at a dotted path (undefined when a parent is missing). */
export function getPath(object, path) {
  let current = object;
  for (const key of String(path).split(".")) {
    if (current === null || current === undefined) return undefined;
    current = current[key];
  }
  return current;
}

/** Set a dotted path, creating the parents. */
export function setPath(object, path, value) {
  const keys = String(path).split(".");
  let current = object;
  for (const key of keys.slice(0, -1)) {
    if (!isPlain(current[key])) current[key] = {};
    current = current[key];
  }
  current[keys.at(-1)] = value;
  return object;
}

/** Remove a dotted path (parents are left in place). */
export function deletePath(object, path) {
  const keys = String(path).split(".");
  const parent = getPath(object, keys.slice(0, -1).join("."));
  if (isPlain(parent)) delete parent[keys.at(-1)];
}

/**
 * Leaves of a nested object as `{ path, value }`. Arrays are leaves; empty objects give nothing.
 * @param {object} object
 * @param {string} [prefix]
 * @returns {{ path: string, value: * }[]}
 */
export function leaves(object, prefix = "") {
  const result = [];
  for (const [key, value] of Object.entries(object ?? {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlain(value)) result.push(...leaves(value, path));
    else result.push({ path, value });
  }
  return result;
}

/** Deep equality of JSON-like values (key order ignored). */
export function same(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => same(v, b[i]));
  }
  if (isPlain(a) && isPlain(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].every((key) => same(a[key], b[key]));
  }
  // "2" and 2 are the same proposal for a formula field
  return (typeof a === "number" || typeof a === "string") && (typeof b === "number" || typeof b === "string")
    && a !== "" && b !== "" && String(a) === String(b);
}

/** A 16-character document id, the format Foundry requires. */
export const ID_PATTERN = /^[a-zA-Z0-9]{16}$/;

const CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/** Default id generator when none is injected (Foundry passes `foundry.utils.randomID`). */
export function randomId() {
  let id = "";
  for (let i = 0; i < 16; i++) id += CHARS[Math.floor(Math.random() * CHARS.length)];
  return id;
}
