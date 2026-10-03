// Draft state for device settings that are edited locally and applied explicitly (PLAN2 R03).
// Pure reducer, no I/O and no React: see tools/test-band-draft.cjs.
//
// Four things are kept apart:
//   observed  the latest successful observation from the heartbeat
//   draft     what the user is editing (what the controls show and what Apply submits)
//   pending   the immutable snapshot of an in-flight submission
//   verifying a successful submission waiting for a read-back that confirms it
//
// "Dirty" is derived (draft differs semantically from the baseline), never stored, so equivalent
// heartbeat arrays (same bands, new array identity) cannot reset or flag anything.

import { lockedBandsOf, normaliseBands, sameBands } from '../../../data/bands'
import type { BandLockState, SignalInfo } from '../../../types'

/** How a setting's observation maps to an editable value. */
export interface DraftSpec<O, V> {
  /** Value a pristine draft shows for an observation (unknown/automatic bands are an empty selection). */
  draftOf(obs: O): V
  sameValue(a: V, b: V): boolean
  sameObs(a: O, b: O): boolean
  /** False when the observation is missing/unreadable: that is not evidence of any setting. */
  known(obs: O): boolean
  /** True when the observation proves `value` is now in effect. */
  confirms(obs: O, value: V): boolean
}

export interface DraftState<O, V> {
  observed: O
  draft: V
  /** Frozen snapshot of the submission in flight. Controls are locked while set. */
  pending: V | null
  /** The device changed this setting while the draft was dirty; the draft was kept. */
  conflict: boolean
  /** A submission was accepted; waiting for a read-back that shows it (older observations are ignored). */
  verifying: { applied: V; previous: O; stale: number } | null
  /** The read-back never showed the applied value. The draft was re-baselined to what the device reports. */
  mismatch: boolean
}

export type DraftAction<O, V> =
  | { type: 'observe'; obs: O }
  | { type: 'edit'; update: (draft: V) => V }
  | { type: 'cancel' }
  | { type: 'submit'; snapshot: V }
  | { type: 'applied'; snapshot: V }
  | { type: 'failed' }

/** Observations that still show the old value (or nothing) before we conclude the apply did not stick. */
export const VERIFY_STALE_LIMIT = 3

export function initDraft<O, V>(spec: DraftSpec<O, V>, obs: O): DraftState<O, V> {
  return { observed: obs, draft: spec.draftOf(obs), pending: null, conflict: false, verifying: null, mismatch: false }
}

/** The value the draft is compared against: the applied value while a read-back is awaited. */
export function baselineOf<O, V>(spec: DraftSpec<O, V>, s: DraftState<O, V>): V {
  return s.verifying ? s.verifying.applied : spec.draftOf(s.observed)
}

export function isDirty<O, V>(spec: DraftSpec<O, V>, s: DraftState<O, V>): boolean {
  return !spec.sameValue(s.draft, baselineOf(spec, s))
}

/** Conflict is only meaningful while there is something to lose. */
export function hasConflict<O, V>(spec: DraftSpec<O, V>, s: DraftState<O, V>): boolean {
  return s.conflict && isDirty(spec, s)
}

export function reduceDraft<O, V>(spec: DraftSpec<O, V>, s: DraftState<O, V>, a: DraftAction<O, V>): DraftState<O, V> {
  switch (a.type) {
    case 'observe': {
      const obs = a.obs
      // The submitted request owns the draft until it settles; remember what the device says meanwhile.
      if (s.pending) return spec.sameObs(obs, s.observed) ? s : { ...s, observed: obs }

      const v = s.verifying
      if (v) {
        if (spec.confirms(obs, v.applied)) {
          // Read-back confirms the apply: re-baseline. A deliberate edit made while waiting is kept.
          const followsApplied = spec.sameValue(s.draft, v.applied)
          return { ...s, observed: obs, draft: followsApplied ? spec.draftOf(obs) : s.draft, verifying: null, conflict: false, mismatch: false }
        }
        const stillOld = !spec.known(obs) || spec.sameObs(obs, v.previous)
        if (stillOld && v.stale + 1 < VERIFY_STALE_LIMIT) {
          return { ...s, verifying: { ...v, stale: v.stale + 1 } }
        }
        // Still old after several reads, or a third value: stop pretending, show the device's truth.
        const draft = spec.known(obs) ? spec.draftOf(obs) : s.draft
        return { ...s, observed: obs, draft, verifying: null, conflict: false, mismatch: true }
      }

      if (spec.sameObs(obs, s.observed)) return s
      const pristine = spec.sameValue(s.draft, spec.draftOf(s.observed))
      if (pristine) return { ...s, observed: obs, draft: spec.draftOf(obs), conflict: false }
      // Dirty draft: keep it, show the new observation, flag the conflict unless the edit already matches.
      return { ...s, observed: obs, conflict: !spec.sameValue(s.draft, spec.draftOf(obs)) }
    }
    case 'edit': {
      if (s.pending) return s
      const draft = a.update(s.draft)
      const conflict = s.conflict && !spec.sameValue(draft, spec.draftOf(s.observed))
      return { ...s, draft, conflict, mismatch: false }
    }
    case 'cancel': {
      if (s.pending) return s
      return { ...s, draft: baselineOf(spec, s), conflict: false, mismatch: false }
    }
    case 'submit':
      return s.pending ? s : { ...s, pending: a.snapshot, mismatch: false }
    case 'applied':
      return {
        ...s,
        pending: null,
        draft: a.snapshot,
        conflict: false,
        mismatch: false,
        verifying: { applied: a.snapshot, previous: s.observed, stale: 0 },
      }
    case 'failed':
      // The draft stays for correction or retry.
      return { ...s, pending: null, conflict: false }
  }
}

// ── Band locks ────────────────────────────────────────────────────────────────

export const bandSpec: DraftSpec<BandLockState, number[]> = {
  draftOf: (o) => normaliseBands(lockedBandsOf(o)),
  sameValue: sameBands,
  sameObs: (a, b) => a.kind === b.kind && (a.kind !== 'locked' || b.kind !== 'locked' || sameBands(a.bands, b.bands)),
  known: (o) => o.kind !== 'unknown',
  confirms: (o, v) => o.kind !== 'unknown' && sameBands(lockedBandsOf(o), v),
}

const UNKNOWN: BandLockState = { kind: 'unknown' }

/** LTE observation; a missing read-back is unknown, never "automatic". */
export function lteObservation(signal: Pick<SignalInfo, 'lte_band_lock_state'> | null | undefined): BandLockState {
  return signal?.lte_band_lock_state ?? UNKNOWN
}

/** NR SA observation. Deliberately never reads the NSA state: they are independent settings. */
export function nrSaObservation(signal: Pick<SignalInfo, 'nr_sa_band_lock_state'> | null | undefined): BandLockState {
  return signal?.nr_sa_band_lock_state ?? UNKNOWN
}

export function toggleBand(draft: number[], band: number): number[] {
  return draft.includes(band) ? normaliseBands(draft.filter((b) => b !== band)) : normaliseBands([...draft, band])
}

// ── Network mode ──────────────────────────────────────────────────────────────

/** Observation = the reported `net_select` (undefined when not reported); draft '' = nothing chosen. */
export const modeSpec: DraftSpec<string | undefined, string> = {
  draftOf: (o) => o ?? '',
  sameValue: (a, b) => a === b,
  sameObs: (a, b) => a === b,
  known: (o) => o !== undefined,
  confirms: (o, v) => o !== undefined && o === v,
}
