// Pins the single signal-quality policy (PLAN2 R01): inclusive lower boundaries.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { loadTs } = require('./ts-loader.cjs')
const q = loadTs('data/signalQuality.ts')
const fmt = loadTs('format.ts')

const level = (metric, value) => q.classifySignal(metric, value).level
const EPS = 0.001

// [metric, boundary, level at/above the boundary, level just below it]
const BOUNDARIES = [
  ['rsrp', -80, 'excellent', 'good'],
  ['rsrp', -90, 'good', 'fair'],
  ['rsrp', -100, 'fair', 'poor'],
  ['rsrq', -10, 'excellent', 'good'],
  ['rsrq', -15, 'good', 'fair'],
  ['rsrq', -20, 'fair', 'poor'],
  ['sinr', 20, 'excellent', 'good'],
  ['sinr', 10, 'good', 'fair'],
  ['sinr', 0, 'fair', 'poor'],
]

for (const [metric, edge, atOrAbove, below] of BOUNDARIES) {
  test(`${metric} boundary ${edge}: below, at and above`, () => {
    assert.equal(level(metric, edge - EPS), below, 'just below')
    assert.equal(level(metric, edge), atOrAbove, 'exactly at')
    assert.equal(level(metric, edge + EPS), atOrAbove, 'just above')
  })
}

test('extremes: very strong is excellent, very weak is poor', () => {
  assert.equal(level('rsrp', -44), 'excellent')
  assert.equal(level('rsrp', -140), 'poor')
  assert.equal(level('rsrq', -3), 'excellent')
  assert.equal(level('rsrq', -43), 'poor')
  assert.equal(level('sinr', 30), 'excellent')
  assert.equal(level('sinr', -23), 'poor')
})

test('tones: excellent/good are ok, fair warns, poor is danger, unknown is neutral', () => {
  assert.deepEqual(q.classifySignal('rsrp', -70), { level: 'excellent', label: 'Excellent', tone: 'ok' })
  assert.deepEqual(q.classifySignal('rsrp', -85), { level: 'good', label: 'Good', tone: 'ok' })
  assert.deepEqual(q.classifySignal('rsrp', -95), { level: 'fair', label: 'Fair', tone: 'warn' })
  assert.deepEqual(q.classifySignal('rsrp', -110), { level: 'poor', label: 'Poor', tone: 'danger' })
  assert.deepEqual(q.classifySignal('rsrp', undefined), { level: 'unknown', label: 'Unavailable', tone: 'neutral' })
})

test('unknown, NaN, infinities, null, strings and undefined are neutral and unavailable', () => {
  for (const metric of ['rsrp', 'rsrq', 'sinr', 'rssi']) {
    for (const bad of [undefined, null, NaN, Infinity, -Infinity, '', '-80', {}]) {
      const c = q.classifySignal(metric, bad)
      assert.equal(c.level, 'unknown', `${metric} ${String(bad)}`)
      assert.equal(c.tone, 'neutral')
      assert.equal(c.label, 'Unavailable')
    }
  }
})

test('SINR 0 is a valid reading (fair), not absent', () => {
  assert.equal(q.classifySignal('sinr', 0).level, 'fair')
  assert.equal(q.classifySignal('sinr', -0.5).level, 'poor')
})

test('RSSI is never rated, whatever the value', () => {
  for (const value of [-30, -49, -80, -120, 0]) {
    const c = q.classifySignal('rssi', value)
    assert.equal(c.level, 'unknown')
    assert.equal(c.tone, 'neutral')
    assert.equal(c.label, 'Not rated')
  }
  assert.deepEqual(q.signalLegend('rssi'), [])
})

test('plan example: RSRP -54, RSRQ -13, SINR 7.5, RSSI -49 is ok/ok/warn/neutral', () => {
  assert.equal(q.classifySignal('rsrp', -54).tone, 'ok')
  assert.equal(q.classifySignal('rsrq', -13).tone, 'ok')
  assert.equal(q.classifySignal('sinr', 7.5).tone, 'warn')
  assert.equal(q.classifySignal('rssi', -49).tone, 'neutral')
  assert.equal(q.classifySignal('sinr', 3).tone, 'warn')
  assert.equal(q.classifySignal('sinr', 12).tone, 'ok')
})

test('legend text is generated from the same policy table', () => {
  const ranges = (metric) => q.signalLegend(metric).map((r) => r.range)
  assert.deepEqual(ranges('rsrp'), ['≥ −80', '−90 to −80', '−100 to −90', '< −100'])
  assert.deepEqual(ranges('rsrq'), ['≥ −10', '−15 to −10', '−20 to −15', '< −20'])
  assert.deepEqual(ranges('sinr'), ['≥ 20', '10 to 20', '0 to 10', '< 0'])
  assert.deepEqual(q.signalLegend('sinr').map((r) => r.rangeWithUnit), ['≥ 20 dB', '10 to 20 dB', '0 to 10 dB', '< 0 dB'])
  assert.equal(q.signalLegend('rsrp')[0].rangeWithUnit, '≥ −80 dBm')
  assert.deepEqual(q.signalLegend('rsrp').map((r) => r.label), ['Excellent', 'Good', 'Fair', 'Poor'])
  assert.deepEqual(q.signalLegend('rsrp').map((r) => r.tone), ['ok', 'ok', 'warn', 'danger'])
  assert.equal(q.signalUnit('rsrp'), 'dBm')
  assert.equal(q.signalUnit('sinr'), 'dB')
})

test('every legend row classifies consistently with classifySignal at its own lower bound', () => {
  for (const metric of ['rsrp', 'rsrq', 'sinr']) {
    const rows = q.signalLegend(metric)
    q.SIGNAL_POLICY[metric].levels.forEach(({ level: lv, min }, i) => {
      assert.equal(rows[i].level, lv)
      if (min !== null) assert.equal(q.classifySignal(metric, min).level, lv)
    })
  }
})

test('format.ts helpers delegate to the policy and keep the Quality contract', () => {
  assert.equal(fmt.rsrpQuality(-54), 'excellent')
  assert.equal(fmt.rsrpQuality(-90), 'good')
  assert.equal(fmt.rsrpQuality(undefined), 'unknown')
  assert.equal(fmt.rsrpQuality(NaN), 'unknown')
  assert.equal(fmt.qualityLabel('poor'), 'Poor')
  assert.equal(fmt.qualityText('good'), 'text-ok')
  assert.equal(fmt.qualityText('fair'), 'text-warn')
  assert.equal(fmt.qualityText('poor'), 'text-danger')
  assert.equal(fmt.qualityText('unknown'), 'text-ink3')
  assert.equal(fmt.qualityBg('poor'), 'bg-danger')
  assert.equal(fmt.rsrqColorClass(-13), 'text-ok')
  assert.equal(fmt.rsrqColorClass(-17), 'text-warn')
  assert.equal(fmt.rsrqColorClass(-25), 'text-danger')
  assert.equal(fmt.rsrqColorClass(undefined), 'text-ink3')
  assert.equal(fmt.sinrColorClass(7.5), 'text-warn')
  assert.equal(fmt.sinrColorClass(0), 'text-warn')
  assert.equal(fmt.sinrColorClass(12), 'text-ok')
  assert.equal(fmt.sinrColorClass(-3), 'text-danger')
  assert.equal(fmt.sinrColorClass(null), 'text-ink3')
  assert.equal(fmt.rsrpColorClass(-100), 'text-warn')
})

test('format helpers keep unknown, zero and real values distinct', () => {
  assert.equal(fmt.formatBytes(null), '—')
  assert.equal(fmt.formatBytes(undefined), '—')
  assert.equal(fmt.formatBytes(NaN), '—')
  assert.equal(fmt.formatBytes(-5), '—')
  assert.equal(fmt.formatBytes(0), '0 B')
  assert.equal(fmt.formatBytes(1_500_000), '1.5 MB')
  assert.equal(fmt.formatCounterTime(null), '—')
  assert.equal(fmt.formatCounterTime(0), '0m')
  assert.equal(fmt.formatCounterTime(5400), '1h 30m')
})
