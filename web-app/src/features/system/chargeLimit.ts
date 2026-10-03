// Charge-limit draft rules. The range only edits a local draft; nothing is
// written until Apply, so pointer and keyboard quirks can't send settings.

export const LIMIT_MIN = 50
export const LIMIT_MAX = 100
export const LIMIT_STEP = 5

/** A limit the slider can represent: an integer step between the bounds. */
export function validLimit(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null
  if (value < LIMIT_MIN || value > LIMIT_MAX || (value - LIMIT_MIN) % LIMIT_STEP !== 0) return null
  return value
}

/** The value Apply should send, or null when there is nothing to commit. */
export function limitToApply(draft: number | null, observed: number | null | undefined): number | null {
  const value = validLimit(draft)
  return value != null && value !== observed ? value : null
}
