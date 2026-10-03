// Band-lock observation parsing (PLAN2 R03). Pure helpers, no I/O.
//
// Verified firmware encodings (HK B04):
//   LTE   lte_band_lock         '0x87e29a0e00df'   hex bitmask string, band N = bit N-1
//   NR SA nr5g_sa_band_lock     '1,2,3,5,...'      comma list of band numbers
//   NR NSA nr5g_nsa_band_lock   '1,2,3,5,...'      same; observed independently of SA
//   stock UCI default for each: '0' (no explicit restriction)
//
// Missing / non-string  -> unknown   (never "automatic": absence is not proof of unlock)
// '' or '0'             -> automatic (no explicit restriction)
// parseable list / mask -> locked    (sorted, deduplicated band numbers)
// anything else         -> unknown

import type { BandLockState } from '../types'

export type { BandLockState }

const MAX_LTE_BAND = 128
const MAX_NR_BAND = 1024

/** Positive integers only, deduplicated and ascending. Does not mutate the input. */
export function normaliseBands(list: Iterable<number> | null | undefined): number[] {
  if (!list) return []
  const out = new Set<number>()
  for (const b of list) {
    if (Number.isInteger(b) && b > 0) out.add(b)
  }
  return [...out].sort((a, b) => a - b)
}

/** Semantic equality: order and duplicates do not matter. */
export function sameBands(a: Iterable<number> | null | undefined, b: Iterable<number> | null | undefined): boolean {
  const x = normaliseBands(a)
  const y = normaliseBands(b)
  return x.length === y.length && x.every((band, i) => band === y[i])
}

const UNKNOWN: BandLockState = { kind: 'unknown' }
const AUTOMATIC: BandLockState = { kind: 'automatic' }

/** LTE: hex ('0x...') or decimal bitmask string. */
export function parseLteBandLock(raw: unknown): BandLockState {
  if (typeof raw !== 'string') return UNKNOWN
  const t = raw.trim()
  if (t === '' || t === '0') return AUTOMATIC
  if (!/^(?:0[xX][0-9a-fA-F]+|\d+)$/.test(t)) return UNKNOWN
  let mask: bigint
  try {
    mask = BigInt(t)
  } catch {
    return UNKNOWN
  }
  if (mask === 0n) return AUTOMATIC
  const bands: number[] = []
  for (let b = 1; b <= MAX_LTE_BAND; b++) {
    if ((mask >> BigInt(b - 1)) & 1n) bands.push(b)
  }
  // Bits above the supported range mean we cannot represent the lock faithfully.
  if (mask >> BigInt(MAX_LTE_BAND) !== 0n || bands.length === 0) return UNKNOWN
  return { kind: 'locked', bands }
}

/** NR (SA or NSA, parsed separately by the caller): comma-separated band numbers. */
export function parseNrBandLock(raw: unknown): BandLockState {
  if (typeof raw !== 'string') return UNKNOWN
  const t = raw.trim()
  if (t === '' || t === '0') return AUTOMATIC
  const bands: number[] = []
  for (const token of t.split(',')) {
    const part = token.trim()
    if (!/^\d+$/.test(part)) return UNKNOWN
    const n = Number(part)
    if (n < 1 || n > MAX_NR_BAND) return UNKNOWN
    bands.push(n)
  }
  return { kind: 'locked', bands: normaliseBands(bands) }
}

export type BandLockDescription =
  | { kind: 'unknown'; bands: [] }
  | { kind: 'automatic'; bands: [] }
  /** The lock covers every supported band: displayed as "All bands". */
  | { kind: 'all'; bands: number[] }
  | { kind: 'subset'; bands: number[] }

/**
 * Presentation classification of a lock against the capability band list.
 * A lock that includes every supported band is "all" (owner decision: shown as
 * "All bands"); with no capability list it can only be a "subset" claim.
 */
export function describeBandLock(state: BandLockState, supportedBands: Iterable<number> | null | undefined): BandLockDescription {
  if (state.kind === 'unknown') return { kind: 'unknown', bands: [] }
  if (state.kind === 'automatic') return { kind: 'automatic', bands: [] }
  const bands = normaliseBands(state.bands)
  const supported = normaliseBands(supportedBands)
  const locked = new Set(bands)
  if (supported.length > 0 && supported.every((b) => locked.has(b))) return { kind: 'all', bands }
  return { kind: 'subset', bands }
}

/** Bands of a locked state, otherwise undefined. */
export function lockedBandsOf(state: BandLockState | undefined): number[] | undefined {
  return state?.kind === 'locked' ? state.bands : undefined
}
