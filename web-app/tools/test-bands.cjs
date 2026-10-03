// Band-lock parsing (PLAN2 R03). Fixtures: sanitised shape based on HK B04
// (SA unit, 2026-10-01); band lists are the public supported-band sets.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { loadTs } = require('./ts-loader.cjs')
const bands = loadTs('data/bands.ts')
const api = loadTs('data/api.ts', { stubs: { client: { get: async () => ({}), post: async () => ({}), put: async () => ({}), req: async () => ({}), readCsv: async () => '' } } })

const NR_LIST = '1,2,3,5,7,8,18,20,26,28,29,38,40,41,48,66,71,75,77,78,79'
const NR_SUPPORTED = [1, 2, 3, 5, 7, 8, 18, 20, 26, 28, 29, 38, 40, 41, 48, 66, 71, 75, 77, 78, 79]
const LTE_SUPPORTED = [1, 2, 3, 4, 5, 7, 8, 18, 19, 20, 26, 28, 29, 32, 34, 38, 39, 40, 41, 42, 43, 48, 66, 71]

test('normaliseBands sorts, deduplicates and drops non-positive or non-integer entries', () => {
  assert.deepEqual(bands.normaliseBands([78, 1, 78, 3, 0, -1, 2.5, NaN]), [1, 3, 78])
  assert.deepEqual(bands.normaliseBands(new Set([5, 1])), [1, 5])
  assert.deepEqual(bands.normaliseBands(undefined), [])
  const input = [3, 1]
  bands.normaliseBands(input)
  assert.deepEqual(input, [3, 1], 'does not mutate its input')
})

test('sameBands compares sets semantically, regardless of order or duplicates', () => {
  assert.equal(bands.sameBands([1, 3, 78], [78, 3, 1]), true)
  assert.equal(bands.sameBands([1, 3, 3], [3, 1]), true)
  assert.equal(bands.sameBands([1, 3], [1, 3, 78]), false)
  assert.equal(bands.sameBands([], undefined), true)
  assert.equal(bands.sameBands(new Set([2, 1]), [1, 2]), true)
})

test('LTE hex mask from the device decodes to sorted bands (band N = bit N-1)', () => {
  const state = bands.parseLteBandLock('0x87e29a0e00df')
  assert.equal(state.kind, 'locked')
  assert.deepEqual(state.bands, [1, 2, 3, 4, 5, 7, 8, 18, 19, 20, 26, 28, 29, 32, 34, 38, 39, 40, 41, 42, 43, 48])
  assert.equal(bands.parseLteBandLock('0x1').bands[0], 1)
  assert.deepEqual(bands.parseLteBandLock('0x8000000000').bands, [40])
  assert.deepEqual(bands.parseLteBandLock('257').bands, [1, 9])
})

test("LTE '', '0' and zero masks are automatic; missing/non-string/unparseable are unknown", () => {
  for (const auto of ['', '0', ' 0 ', '0x0', '0x00']) assert.deepEqual(bands.parseLteBandLock(auto), { kind: 'automatic' }, JSON.stringify(auto))
  for (const unk of [undefined, null, 0, 5, true, {}, 'garbage', '0xZZ', '1,2,3', '-1', '1.5']) {
    assert.deepEqual(bands.parseLteBandLock(unk), { kind: 'unknown' }, JSON.stringify(unk))
  }
})

test('NR lists: sorted, deduplicated, tolerant of spaces; empty or 0 is automatic', () => {
  assert.deepEqual(bands.parseNrBandLock('78,41, 3,78'), { kind: 'locked', bands: [3, 41, 78] })
  assert.deepEqual(bands.parseNrBandLock(NR_LIST).bands, NR_SUPPORTED)
  assert.deepEqual(bands.parseNrBandLock('78'), { kind: 'locked', bands: [78] })
  assert.deepEqual(bands.parseNrBandLock(''), { kind: 'automatic' })
  assert.deepEqual(bands.parseNrBandLock('0'), { kind: 'automatic' })
})

test('NR unparseable, missing and non-string values are unknown', () => {
  for (const unk of [undefined, null, 78, ['78'], 'n78', '1,,2', '1,x', '0,78', '78,', '-5', '99999', 'auto']) {
    assert.deepEqual(bands.parseNrBandLock(unk), { kind: 'unknown' }, JSON.stringify(unk))
  }
})

test('describeBandLock: a lock covering every supported band is "all"', () => {
  const all = bands.describeBandLock(bands.parseNrBandLock(NR_LIST), NR_SUPPORTED)
  assert.equal(all.kind, 'all')
  assert.deepEqual(all.bands, NR_SUPPORTED)
  const superset = bands.describeBandLock({ kind: 'locked', bands: [...NR_SUPPORTED, 257] }, NR_SUPPORTED)
  assert.equal(superset.kind, 'all')
  const subset = bands.describeBandLock({ kind: 'locked', bands: [78, 41] }, NR_SUPPORTED)
  assert.deepEqual(subset, { kind: 'subset', bands: [41, 78] })
  assert.equal(bands.describeBandLock({ kind: 'locked', bands: [78] }, []).kind, 'subset')
  assert.equal(bands.describeBandLock({ kind: 'locked', bands: [78] }, undefined).kind, 'subset')
  assert.deepEqual(bands.describeBandLock({ kind: 'automatic' }, NR_SUPPORTED), { kind: 'automatic', bands: [] })
  assert.deepEqual(bands.describeBandLock({ kind: 'unknown' }, NR_SUPPORTED), { kind: 'unknown', bands: [] })
  // the live LTE mask is a partial set of the capability list, not "all"
  assert.equal(bands.describeBandLock(bands.parseLteBandLock('0x87e29a0e00df'), LTE_SUPPORTED).kind, 'subset')
})

test('lockedBandsOf returns bands only for a locked state', () => {
  assert.deepEqual(bands.lockedBandsOf({ kind: 'locked', bands: [1] }), [1])
  assert.equal(bands.lockedBandsOf({ kind: 'automatic' }), undefined)
  assert.equal(bands.lockedBandsOf({ kind: 'unknown' }), undefined)
  assert.equal(bands.lockedBandsOf(undefined), undefined)
})

// ── mapSignal wiring: SA and NSA are parsed independently ───────────────────────

const base = { network_type: 'SA', net_select: 'Only_5G', lte_band_lock: '0x87e29a0e00df' }

test('mapSignal: known-empty SA with a non-empty NSA lock stays automatic (no NSA fallback)', () => {
  const s = api.mapSignal({ ...base, nr5g_sa_band_lock: '', nr5g_nsa_band_lock: NR_LIST })
  assert.deepEqual(s.nr_sa_band_lock_state, { kind: 'automatic' })
  assert.equal(s.nr_nsa_band_lock_state.kind, 'locked')
})

test('mapSignal: missing SA with a non-empty NSA lock is unknown, not NSA bands', () => {
  const s = api.mapSignal({ ...base, nr5g_nsa_band_lock: NR_LIST })
  assert.deepEqual(s.nr_sa_band_lock_state, { kind: 'unknown' })
  assert.equal(s.nr_nsa_band_lock_state.kind, 'locked')
})

test('mapSignal: stock default "0" is automatic for SA, NSA and LTE; hex LTE mask is locked', () => {
  const s = api.mapSignal({ network_type: 'SA', lte_band_lock: '0', nr5g_sa_band_lock: '0', nr5g_nsa_band_lock: '0' })
  assert.deepEqual(s.lte_band_lock_state, { kind: 'automatic' })
  assert.deepEqual(s.nr_sa_band_lock_state, { kind: 'automatic' })
  assert.deepEqual(s.nr_nsa_band_lock_state, { kind: 'automatic' })
  const live = api.mapSignal({ ...base, nr5g_sa_band_lock: NR_LIST, nr5g_nsa_band_lock: NR_LIST })
  assert.equal(live.lte_band_lock_state.kind, 'locked')
  assert.deepEqual(live.nr_sa_band_lock_state.bands, NR_SUPPORTED)
  assert.equal(live.raw_lte_band_lock, '0x87e29a0e00df')
  assert.equal(live.raw_nr_sa_band_lock, NR_LIST)
})

test('mapSignal: unparseable locks are unknown, independently per control', () => {
  const s = api.mapSignal({ ...base, lte_band_lock: 'zzz', nr5g_sa_band_lock: 'n78', nr5g_nsa_band_lock: '41' })
  assert.deepEqual(s.lte_band_lock_state, { kind: 'unknown' })
  assert.deepEqual(s.nr_sa_band_lock_state, { kind: 'unknown' })
  assert.deepEqual(s.nr_nsa_band_lock_state, { kind: 'locked', bands: [41] })
})

test('mapSignal: equivalent lock lists in a different order are sameBands', () => {
  const a = api.mapSignal({ ...base, nr5g_sa_band_lock: '78,41,3' })
  const b = api.mapSignal({ ...base, nr5g_sa_band_lock: '3,78,41,3' })
  assert.equal(bands.sameBands(a.nr_sa_band_lock_state.bands, b.nr_sa_band_lock_state.bands), true)
})
