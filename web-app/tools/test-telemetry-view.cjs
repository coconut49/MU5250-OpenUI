// Presentation logic for Home / Signal overview (PLAN2 R01, R04/R05, R06, U05).
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { loadTs } = require('./ts-loader.cjs')
const v = loadTs('features/signal/telemetryView.ts')
const place = loadTs('features/signal/tooltipPlacement.ts')
const stubClient = { get: async () => ({}), post: async () => ({}), put: async () => ({}), req: async () => ({}), readCsv: async () => '' }
const api = loadTs('data/api.ts', { stubs: { client: stubClient } })

test('plan example: RSRP -54 / RSRQ -13 / SINR 7.5 / RSSI -49 -> ok / ok / warn / neutral', () => {
  const m = (k, x) => v.metricView(k, x)
  assert.deepEqual([m('rsrp', -54).tone, m('rsrp', -54).word, m('rsrp', -54).className], ['ok', 'Excellent', 'text-ok'])
  assert.deepEqual([m('rsrq', -13).tone, m('rsrq', -13).word, m('rsrq', -13).className], ['ok', 'Good', 'text-ok'])
  assert.deepEqual([m('sinr', 7.5).tone, m('sinr', 7.5).word, m('sinr', 7.5).className], ['warn', 'Fair', 'text-warn'])
  const rssi = m('rssi', -49)
  assert.deepEqual([rssi.tone, rssi.word, rssi.className, rssi.text], ['neutral', null, 'text-ink2', '-49'])
})

test('raw readings keep their precision; SINR 0 is a real, rated reading', () => {
  assert.equal(v.metricView('sinr', 7.5).text, '7.5')
  assert.equal(v.metricView('rsrq', -11).text, '-11')
  const zero = v.metricView('sinr', 0)
  assert.equal(zero.text, '0')
  assert.equal(zero.level, 'fair')
})

test('unknown values are neutral and Unavailable, never rated', () => {
  for (const x of [undefined, null, NaN, Infinity, '-50']) {
    for (const k of ['rsrp', 'rsrq', 'sinr', 'rssi']) {
      const r = v.metricView(k, x)
      assert.equal(r.text, null)
      assert.equal(r.word, 'Unavailable')
      assert.equal(r.tone, 'neutral')
      assert.equal(r.className, 'text-ink3')
    }
  }
})

test('servingView uses signal.primary only and labels the RAT', () => {
  const sa = { type: 'SA', primary: { rat: 'nr', carrier: { label: 'PCC', band: 'n78', pci: 745 } } }
  assert.deepEqual(
    { rat: v.servingView(sa).rat, label: v.servingView(sa).label, pci: v.servingView(sa).pci },
    { rat: '5G SA', label: '5G SA · n78', pci: 745 },
  )
  const nsa = { type: 'ENDC', primary: { rat: 'lte', carrier: { label: 'PCC', band: 'B8', pci: 312 } } }
  assert.equal(v.servingView(nsa).label, 'LTE anchor (NSA) · B8')
  const lte = { type: 'LTE', primary: { rat: 'lte', carrier: { label: 'PCC', band: 'B3' } } }
  assert.equal(v.servingView(lte).label, 'LTE · B3')
  // Raw-looking fields are ignored: no primary means unavailable, even with an LTE carrier listed.
  const ghost = { type: 'No Service', lte_carriers: [{ label: 'PCC', band: 'B1', rsrp: 0 }], nr_carriers: [], rsrp: 0 }
  assert.deepEqual(v.servingView(ghost), { available: false, rat: null, label: null })
  assert.equal(v.servingView(null).available, false)
})

test('PCI 0 on the primary is kept', () => {
  const s = { type: 'LTE', primary: { rat: 'lte', carrier: { label: 'PCC', band: 'B1', pci: 0 } } }
  assert.equal(v.servingView(s).pci, 0)
})

test('mapper -> view: disconnected all-zero payload has no serving cell and no rating', () => {
  const sig = api.mapSignal({ network_type: 'No Service', signalbar: '', lte_rsrp: 0, lte_rsrq: 0, lte_snr: 0, nr5g_rsrp: 0, wan_active_band: '', nr5g_action_band: '' })
  assert.equal(v.servingView(sig).available, false)
  assert.equal(v.barsText(sig.signal_bars), null)
})

test('mapper -> view: SA payload with populated LTE fields serves NR, RSRQ -11 rated good', () => {
  const sig = api.mapSignal({
    network_type: 'SA', signalbar: '5', nr5g_action_band: 'n78', nr5g_action_channel: 643392, nr5g_pci: 745,
    nr5g_rsrp: -53, nr5g_rsrq: -11, nr5g_snr: '31.0', lte_rsrp: -48, lte_rsrq: -7, lte_snr: '21.0', lte_pci: 0,
  })
  const s = v.servingView(sig)
  assert.equal(s.label, '5G SA · n78')
  assert.equal(v.metricView('rsrq', s.carrier.rsrq).word, 'Good')
  assert.equal(v.metricView('rsrq', s.carrier.rsrq).className, 'text-ok')
})

test('barsText: missing is unknown, genuine 0 is shown', () => {
  assert.equal(v.barsText(undefined), null)
  assert.equal(v.barsText(null), null)
  assert.equal(v.barsText(0), '0/5 bars')
  assert.equal(v.barsText(4), '4/5 bars')
})

const car = (label, bandwidth, active) => ({ label, band: 'n41', earfcn: 1, bandwidth, ...(active === undefined ? {} : { active }) })

test('carrierCounts separates reported, active, idle and unknown', () => {
  const c = v.carrierCounts([car('PCC', '100 MHz', true), car('SCC0', '40 MHz', true), car('SCC1', '60 MHz', false), car('SCC2', '20 MHz')])
  assert.deepEqual({ ...c }, { reported: 4, active: 2, idle: 1, unknown: 1 })
  assert.deepEqual({ ...v.carrierCounts([]) }, { reported: 0, active: 0, idle: 0, unknown: 0 })
})

test('bandwidthSummary: reported sums everything, active only the active ones', () => {
  const b = v.bandwidthSummary([car('PCC', '100 MHz', true), car('SCC0', '40 MHz', true), car('SCC1', '60 MHz', false)])
  assert.deepEqual({ ...b }, { reportedMHz: 200, activeMHz: 140, hasIdle: true })
  const none = v.bandwidthSummary([car('PCC', '—', true)])
  assert.deepEqual({ ...none }, { reportedMHz: 0, activeMHz: 0, hasIdle: false })
})

test('homeUsageRows: "Current cycle" uses the cycle counters, unknown stays null, total needs both', () => {
  const p = (rx, tx) => ({ rx_bytes: rx, tx_bytes: tx, time_secs: null })
  const usage = { day: p(0, 0), month: p(1, 2), cycle: p(10, 20), total: p(null, 5), reset_day: null, reset_enabled: null }
  const rows = v.homeUsageRows(usage).map((r) => ({ ...r }))
  assert.deepEqual(rows, [
    { label: 'Today', rx: 0, tx: 0, total: 0 },
    { label: 'Current cycle', rx: 10, tx: 20, total: 30 },
    { label: 'Total', rx: null, tx: 5, total: null },
  ])
  const noCycle = v.homeUsageRows({ ...usage, cycle: undefined })
  assert.equal(noCycle[1].total, 3, 'falls back to the month counters, which are the same firmware counters')
})

// ── Tooltip geometry ──────────────────────────────────────────────────────────

const rect = (left, top, w = 40, h = 16) => ({ left, right: left + w, top, bottom: top + h })
const inside = (p, h, vw, vh) => p.left >= 0 && p.left + p.width <= vw && p.top >= 0 && p.top + Math.min(h, p.maxHeight) <= vh

test('tooltip left edge is clamped as centre - width/2, not as the centre', () => {
  const vw = 375
  const first = place.placeTooltip(rect(8, 300), 60, vw, 800)
  assert.equal(first.left, place.TIP_MARGIN)
  const last = place.placeTooltip(rect(vw - 48, 300), 60, vw, 800)
  assert.equal(last.left + last.width, vw - place.TIP_MARGIN)
  const mid = place.placeTooltip(rect(167, 300), 60, vw, 800)
  assert.equal(mid.left, 167 + 20 - mid.width / 2)
})

test('tooltip width is capped on narrow viewports', () => {
  const p = place.placeTooltip(rect(100, 300), 60, 200, 800)
  assert.equal(p.width, 200 - 2 * place.TIP_MARGIN)
  assert.equal(place.placeTooltip(rect(100, 300), 60, 1280, 800).width, place.TIP_MAX_WIDTH)
})

test('tooltip flips below near the top and above near the bottom', () => {
  assert.equal(place.placeTooltip(rect(100, 20), 60, 375, 800).side, 'below')
  assert.equal(place.placeTooltip(rect(100, 700), 60, 375, 800).side, 'above')
  assert.equal(place.placeTooltip(rect(100, 400), 60, 375, 800).side, 'above')
})

test('tooltip never overlaps its trigger and stays in the viewport for any position', () => {
  for (const vw of [200, 320, 375, 1280]) {
    for (let left = 0; left <= vw - 40; left += 17) {
      for (const top of [0, 30, 200, 380, 560, 580]) {
        const h = 80
        const t = rect(left, top)
        const p = place.placeTooltip(t, h, vw, 600)
        assert.ok(inside(p, h, vw, 600), `${vw}/${left}/${top}`)
        const bottom = p.top + Math.min(h, p.maxHeight)
        assert.ok(bottom <= t.top || p.top >= t.bottom, 'no overlap with trigger')
      }
    }
  }
})

test('very tall text is capped to the available room', () => {
  const p = place.placeTooltip(rect(100, 300), 2000, 375, 800)
  assert.ok(p.maxHeight < 2000 && p.maxHeight > 0)
  assert.ok(p.top >= 0 && p.top + p.maxHeight <= 800)
})
