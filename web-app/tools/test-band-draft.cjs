// Draft reducer for band locks and network mode (PLAN2 R03) and the R11 confirmation builders.
// Synthetic observations; band lists are the public supported-band sets.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { loadTs } = require('./ts-loader.cjs')
const d = loadTs('features/signal/locking/draft.ts')
const c = loadTs('features/signal/locking/confirmations.ts')

const LTE_SUPPORTED = [1, 2, 3, 4, 5, 7, 8, 18, 19, 20, 26, 28, 29, 32, 34, 38, 39, 40, 41, 42, 43, 48, 66, 71]
const NR_SUPPORTED = [1, 2, 3, 5, 7, 8, 18, 20, 26, 28, 29, 38, 40, 41, 48, 66, 71, 75, 77, 78, 79]

const locked = (...bands) => ({ kind: 'locked', bands })
const AUTO = { kind: 'automatic' }
const UNKNOWN = { kind: 'unknown' }

const spec = d.bandSpec
const reduce = (s, a) => d.reduceDraft(spec, s, a)
const run = (s, ...actions) => actions.reduce(reduce, s)
const observe = (obs) => ({ type: 'observe', obs })
const set = (bands) => ({ type: 'edit', update: () => bands })
const dirty = (s) => d.isDirty(spec, s)
const conflict = (s) => d.hasConflict(spec, s)

test('equivalent heartbeat arrays across three heartbeats leave a dirty draft and the state object untouched', () => {
  let s = d.initDraft(spec, locked(1, 3, 78))
  s = reduce(s, set([1, 3, 7, 78]))
  const before = s
  for (const bands of [[78, 3, 1], [1, 1, 3, 78], [3, 78, 1]]) {
    s = reduce(s, observe(locked(...bands)))
  }
  assert.equal(s, before, 'semantically equal observations are a no-op (same state object)')
  assert.deepEqual(s.draft, [1, 3, 7, 78])
  assert.equal(dirty(s), true)
  assert.equal(conflict(s), false)
})

test('a pristine draft ignores equivalent arrays and follows a real external change', () => {
  let s = d.initDraft(spec, locked(1, 3))
  const same = reduce(s, observe(locked(3, 1)))
  assert.equal(same, s)
  s = reduce(s, observe(locked(1, 3, 78)))
  assert.deepEqual(s.draft, [1, 3, 78])
  assert.equal(dirty(s), false)
  assert.equal(conflict(s), false)
})

test('external change while dirty keeps the draft, records the new observation and flags a conflict', () => {
  let s = d.initDraft(spec, locked(1, 3))
  s = reduce(s, set([1, 3, 7]))
  s = reduce(s, observe(locked(8)))
  assert.deepEqual(s.draft, [1, 3, 7])
  assert.deepEqual(s.observed, locked(8))
  assert.equal(conflict(s), true)
  // Editing the draft to match the new observation resolves the conflict.
  s = reduce(s, set([8]))
  assert.equal(dirty(s), false)
  assert.equal(conflict(s), false)
})

test('a dirty draft that already equals the externally changed lock is not a conflict', () => {
  let s = d.initDraft(spec, locked(1))
  s = reduce(s, set([1, 3]))
  s = reduce(s, observe(locked(3, 1)))
  assert.equal(conflict(s), false)
  assert.equal(dirty(s), false)
})

test('Cancel restores the latest observation, including one that arrived while dirty', () => {
  let s = d.initDraft(spec, locked(1, 3))
  s = run(s, set([2]), observe(locked(5, 7)))
  assert.equal(conflict(s), true)
  s = reduce(s, { type: 'cancel' })
  assert.deepEqual(s.draft, [5, 7])
  assert.equal(dirty(s), false)
  assert.equal(conflict(s), false)
})

test('submit freezes an immutable snapshot; heartbeats and edits during pending cannot alter it', () => {
  let s = d.initDraft(spec, locked(1))
  s = reduce(s, set([1, 78]))
  const snapshot = [...s.draft]
  s = reduce(s, { type: 'submit', snapshot })
  s = run(s, set([2]), observe(locked(41)), { type: 'cancel' })
  assert.deepEqual(s.pending, [1, 78])
  assert.deepEqual(s.draft, [1, 78], 'edits and Cancel are ignored while pending')
  assert.equal(reduce(s, { type: 'submit', snapshot: [9] }).pending.length, 2, 'a second submit cannot replace the snapshot')
})

test('success re-baselines from the fresh read-back; old in-flight observations cannot restore the old selection', () => {
  let s = d.initDraft(spec, locked(1, 3))
  s = run(s, set([1, 78]), { type: 'submit', snapshot: [1, 78] }, { type: 'applied', snapshot: [1, 78] })
  assert.equal(dirty(s), false, 'the applied value is the baseline while waiting')
  // A stale observation from before the apply arrives (same old value, new array identity).
  s = reduce(s, observe(locked(3, 1)))
  assert.deepEqual(s.draft, [1, 78], 'draft is not reset to the previous lock')
  assert.ok(s.verifying)
  // The read-back confirms.
  s = reduce(s, observe(locked(1, 78)))
  assert.equal(s.verifying, null)
  assert.deepEqual(s.observed, locked(1, 78))
  assert.deepEqual(s.draft, [1, 78])
  assert.equal(dirty(s), false)
  assert.equal(s.mismatch, false)
})

test('a read-back that never shows the applied lock is reported as a mismatch and shows the device value', () => {
  let s = d.initDraft(spec, locked(1, 3))
  s = run(s, set([78]), { type: 'submit', snapshot: [78] }, { type: 'applied', snapshot: [78] })
  for (let i = 0; i < d.VERIFY_STALE_LIMIT; i++) s = reduce(s, observe(locked(1, 3)))
  assert.equal(s.verifying, null)
  assert.equal(s.mismatch, true)
  assert.deepEqual(s.draft, [1, 3])
  assert.deepEqual(s.observed, locked(1, 3))
})

test('an edit made while a read-back is awaited survives its arrival', () => {
  let s = d.initDraft(spec, locked(1))
  s = run(s, set([2]), { type: 'submit', snapshot: [2] }, { type: 'applied', snapshot: [2] }, set([2, 3]))
  s = reduce(s, observe(locked(2)))
  assert.deepEqual(s.draft, [2, 3])
  assert.equal(dirty(s), true)
  assert.equal(conflict(s), false)
})

test('failure keeps the draft for correction and unlocks the controls', () => {
  let s = d.initDraft(spec, locked(1))
  s = run(s, set([1, 3]), { type: 'submit', snapshot: [1, 3] }, { type: 'failed' })
  assert.equal(s.pending, null)
  assert.deepEqual(s.draft, [1, 3])
  assert.equal(s.verifying, null)
  assert.equal(dirty(s), true)
  s = reduce(s, set([1, 3, 5]))
  assert.deepEqual(s.draft, [1, 3, 5])
})

test('reset to automatic: applied [] is confirmed only by a known automatic read-back', () => {
  let s = d.initDraft(spec, locked(1, 3))
  s = run(s, { type: 'submit', snapshot: [] }, { type: 'applied', snapshot: [] })
  s = reduce(s, observe(UNKNOWN))
  assert.ok(s.verifying, 'unknown is not a confirmation of unlock')
  s = reduce(s, observe(AUTO))
  assert.equal(s.verifying, null)
  assert.deepEqual(s.observed, AUTO)
  assert.deepEqual(s.draft, [])
  assert.equal(s.mismatch, false)
})

test('known automatic clears a pristine draft; a dirty draft is kept with a conflict', () => {
  let s = d.initDraft(spec, locked(1, 3))
  assert.deepEqual(reduce(s, observe(AUTO)).draft, [])
  s = run(s, set([1, 3, 7]), observe(AUTO))
  assert.deepEqual(s.draft, [1, 3, 7])
  assert.equal(conflict(s), true)
})

test('missing read-back is unknown, not automatic, and never invents a selection', () => {
  assert.deepEqual(d.lteObservation(undefined), UNKNOWN)
  assert.deepEqual(d.lteObservation({}), UNKNOWN)
  assert.deepEqual(d.nrSaObservation(null), UNKNOWN)
  assert.deepEqual(d.nrSaObservation({}), UNKNOWN)
  const s = d.initDraft(spec, UNKNOWN)
  assert.deepEqual(s.draft, [])
  assert.equal(spec.known(UNKNOWN), false)
  // Unknown -> automatic is a state change but the empty draft stays pristine.
  const next = reduce(s, observe(AUTO))
  assert.deepEqual(next.draft, [])
  assert.equal(dirty(next), false)
})

test('SA control uses SA state only: known-empty SA with a nonempty NSA lock stays automatic', () => {
  const signal = { nr_sa_band_lock_state: AUTO, nr_nsa_band_lock_state: locked(...NR_SUPPORTED) }
  assert.deepEqual(d.nrSaObservation(signal), AUTO)
  assert.deepEqual(d.initDraft(spec, d.nrSaObservation(signal)).draft, [])
})

test('missing SA state with a nonempty NSA lock stays unknown (no NSA substitution)', () => {
  const signal = { nr_sa_band_lock_state: UNKNOWN, nr_nsa_band_lock_state: locked(78) }
  assert.deepEqual(d.nrSaObservation(signal), UNKNOWN)
  assert.deepEqual(d.initDraft(spec, d.nrSaObservation(signal)).draft, [])
})

test('independent SA/NSA observations during a network-mode transition: only SA changes move the SA draft', () => {
  let s = d.initDraft(spec, locked(78))
  const heartbeats = [
    { nr_sa_band_lock_state: locked(78), nr_nsa_band_lock_state: locked(1, 3) },
    { nr_sa_band_lock_state: locked(78), nr_nsa_band_lock_state: AUTO },
    { nr_sa_band_lock_state: locked(78), nr_nsa_band_lock_state: UNKNOWN },
  ]
  const before = s
  for (const h of heartbeats) s = reduce(s, observe(d.nrSaObservation(h)))
  assert.equal(s, before)
  s = reduce(s, observe(d.nrSaObservation({ nr_sa_band_lock_state: locked(41, 78), nr_nsa_band_lock_state: locked(78) })))
  assert.deepEqual(s.draft, [41, 78])
})

test('toggleBand adds, removes and keeps the selection sorted and deduplicated', () => {
  assert.deepEqual(d.toggleBand([1, 78], 3), [1, 3, 78])
  assert.deepEqual(d.toggleBand([1, 3, 78], 3), [1, 78])
  assert.deepEqual(d.toggleBand([], 7), [7])
})

test('a lock covering every supported band is "All bands"; a subset lists bands', () => {
  assert.equal(c.describeObserved('lte', locked(...LTE_SUPPORTED), LTE_SUPPORTED), 'All bands')
  assert.equal(c.describeObserved('nr', locked(...NR_SUPPORTED, 99), NR_SUPPORTED), 'All bands')
  assert.equal(c.describeObserved('nr', locked(41, 78), NR_SUPPORTED), 'n41, n78')
  assert.equal(c.describeObserved('lte', locked(3, 8), LTE_SUPPORTED), 'B3, B8')
  assert.match(c.describeObserved('lte', AUTO, LTE_SUPPORTED), /^Automatic/)
  assert.match(c.describeObserved('lte', UNKNOWN, LTE_SUPPORTED), /^Unknown/)
  // No capability list: cannot claim "all".
  assert.equal(c.describeObserved('lte', locked(1, 3), []), 'B1, B3')
})

// ── Network mode ──────────────────────────────────────────────────────────────

const mspec = d.modeSpec
const mreduce = (s, a) => d.reduceDraft(mspec, s, a)

test('network mode: pristine follows the device, a dirty choice survives equal heartbeats and conflicts on change', () => {
  let s = d.initDraft(mspec, 'WL_AND_5G')
  assert.equal(s.draft, 'WL_AND_5G')
  s = mreduce(s, { type: 'edit', update: () => 'Only_5G' })
  const before = s
  for (let i = 0; i < 3; i++) s = mreduce(s, { type: 'observe', obs: 'WL_AND_5G' })
  assert.equal(s, before)
  s = mreduce(s, { type: 'observe', obs: 'Only_LTE' })
  assert.equal(s.draft, 'Only_5G')
  assert.equal(d.hasConflict(mspec, s), true)
  s = mreduce(s, { type: 'cancel' })
  assert.equal(s.draft, 'Only_LTE')
})

test('network mode: unreported mode selects nothing; success waits for the read-back', () => {
  let s = d.initDraft(mspec, undefined)
  assert.equal(s.draft, '')
  assert.equal(d.isDirty(mspec, s), false)
  s = d.initDraft(mspec, 'WL_AND_5G')
  s = [
    { type: 'edit', update: () => 'Only_5G' },
    { type: 'submit', snapshot: 'Only_5G' },
    { type: 'applied', snapshot: 'Only_5G' },
    { type: 'observe', obs: 'WL_AND_5G' },
  ].reduce(mreduce, s)
  assert.equal(s.draft, 'Only_5G')
  s = mreduce(s, { type: 'observe', obs: 'Only_5G' })
  assert.equal(s.verifying, null)
  assert.equal(s.draft, 'Only_5G')
  assert.equal(d.isDirty(mspec, s), false)
})

// ── R11 confirmations ─────────────────────────────────────────────────────────

test('connection confirmations name the operation and target, the consequence and a recovery path', () => {
  const all = [
    c.networkModeConfirm({ value: 'Only_5G', label: '5G SA' }, { value: 'WL_AND_5G', label: '5G / 4G / 3G' }),
    c.bandLockConfirm('nr', [41, 78]),
    c.bandLockConfirm('lte', [3, 8]),
    c.bandResetConfirm(),
    c.cellLockConfirm({ tech: 'nr', pci: '745', earfcn: '643392', band: '78' }),
    c.cellLockConfirm({ tech: 'lte', pci: '312', earfcn: '3650' }),
    c.cellResetConfirm(),
  ]
  for (const o of all) {
    assert.equal(o.kind, 'connection')
    assert.ok(o.details.some((x) => x.label === 'Operation'))
    assert.match(o.consequence, /Internet/)
    assert.match(o.consequence, /dashboard/)
    assert.ok(o.recovery.length > 0)
  }
  assert.deepEqual(c.bandLockConfirm('nr', [41, 78]).details[1], { label: 'Bands', value: 'n41, n78' })
  assert.match(c.bandLockConfirm('lte', [3]).recovery, /Reset bands to automatic/)
  const cell = c.cellLockConfirm({ tech: 'nr', pci: '0', earfcn: '643392', band: '78' })
  assert.deepEqual(cell.details.slice(1), [
    { label: 'PCI', value: '0' },
    { label: 'NR-ARFCN', value: '643392' },
    { label: 'Band', value: 'n78' },
  ])
})
