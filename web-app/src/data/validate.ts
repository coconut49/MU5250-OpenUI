// Boundary validation helpers for agent/firmware payloads.
//
// Rules shared by every mapper:
//   - `undefined` means "absent or malformed"; callers decide what that means.
//   - `null`, '' and whitespace are NOT numbers (never `Number(null)` === 0).
//   - Numeric strings are accepted only in strict decimal form; "12abc" is rejected.
//   - Zero, false and empty lists are real values and are returned unchanged.

export type JsonObject = Record<string, unknown>

const NUMERIC_STRING = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/

/** A finite number, or a strictly numeric string parsed to one. Otherwise undefined. */
export function finiteNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (typeof v === 'string') {
    const t = v.trim()
    if (!NUMERIC_STRING.test(t)) return undefined
    const n = Number(t)
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

/** Finite number >= 0 (zero is valid). */
export function nonNegative(v: unknown): number | undefined {
  const n = finiteNumber(v)
  return n !== undefined && n >= 0 ? n : undefined
}

/** Integer within [min, max] inclusive. Accepts "80" and 80; rejects 80.5, '', null. */
export function intInRange(v: unknown, min: number, max: number): number | undefined {
  const n = finiteNumber(v)
  return n !== undefined && Number.isInteger(n) && n >= min && n <= max ? n : undefined
}

/** Non-negative safe integer (counters, ids). */
export function nonNegativeInt(v: unknown): number | undefined {
  const n = nonNegative(v)
  return n !== undefined && Number.isSafeInteger(n) ? n : undefined
}

const TRUE_WORDS = new Set(['1', 'true', 'on', 'yes', 'enabled', 'enable'])
const FALSE_WORDS = new Set(['0', 'false', 'off', 'no', 'disabled', 'disable'])

/**
 * Tri-state boolean: true / false / undefined (absent or unrecognised).
 * Accepts booleans, the numbers 0 and 1, and the usual firmware words.
 */
export function boolLike(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v === 1 ? true : v === 0 ? false : undefined
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase()
    if (TRUE_WORDS.has(t)) return true
    if (FALSE_WORDS.has(t)) return false
  }
  return undefined
}

/** Any string (including ''), else undefined. */
export function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

/** A string with at least one non-whitespace character, else undefined. */
export function nonEmptyStr(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v : undefined
}

export function isObj(v: unknown): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function obj(v: unknown): JsonObject | undefined {
  return isObj(v) ? v : undefined
}

export function arr(v: unknown): unknown[] | undefined {
  return Array.isArray(v) ? v : undefined
}

/** An array of strings; non-string members are dropped. undefined if not an array. */
export function strList(v: unknown): string[] | undefined {
  const a = arr(v)
  return a ? a.filter((x): x is string => typeof x === 'string') : undefined
}
