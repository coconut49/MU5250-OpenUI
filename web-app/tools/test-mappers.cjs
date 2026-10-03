const { test } = require('node:test')
const assert = require('node:assert/strict')
const { loadTs } = require('./ts-loader.cjs')

// Loads api.ts with a stubbed client so mappers run against raw agent payloads.
function load(response = {}) {
  const client = {
    get: async () => response, post: async () => response, put: async () => response,
    req: async () => response, readCsv: async () => '',
  }
  return loadTs('data/api.ts', { stubs: { client } })
}

// Shape captured from a U60 Pro on HK B04 in 5G SA (2026-10-01); identifiers are synthetic.
const SA_NETINFO = {
  network_type: 'SA', network_provider_fullname: 'Example Carrier', signalbar: '5',
  wan_active_band: 'n28', lte_rsrp: 0, lte_pci: undefined, wan_active_channel: undefined,
  nr5g_cell_id: 305419896, nr5g_pci: 101, nr5g_action_channel: 159130, nr5g_action_band: 'n28',
  nr5g_bandwidth: '15', nr5g_rsrp: -89, nr5g_rsrq: -14, nr5g_snr: '-0.7', nr5g_rssi: -77,
  lteca: '', ltecasig: '', nrca: '0,56,1,78,643392,60,1,-140.0,-43.0,-23.0,-120.0;',
}

test('unmeasured NR SCC reporting floors are not shown as readings', () => {
  const signal = load().mapSignal(SA_NETINFO)
  assert.equal(signal.nr_carriers.length, 2)
  const scc = signal.nr_carriers[1]
  assert.equal(scc.band, 'n78')
  assert.equal(scc.active, false)
  for (const key of ['rsrp', 'rsrq', 'sinr', 'rssi']) assert.equal(scc[key], undefined, key)
  assert.equal(signal.nr_carriers[0].rsrp, -89)
})

test('NR cell IDs are shown whole and survive values beyond 32 bits', () => {
  const { mapSignal } = load()
  assert.equal(mapSignal(SA_NETINFO).cell_id, '12345678')
  const nci = 0x9_1234_5678
  assert.equal(mapSignal({ ...SA_NETINFO, nr5g_cell_id: nci }).cell_id, '912345678')
})

test('LTE and NSA cell IDs split into eNB | cell', () => {
  const signal = load().mapSignal({ ...SA_NETINFO, network_type: 'ENDC', cell_id: 134479973 })
  assert.equal(signal.cell_id, '80400|65')
})

test('battery distinguishes plugged-in-not-charging from on battery', async () => {
  const home = (battery) => load({ battery: { capacity: 80, ...battery } }).api.home()
  const paused = (await home({ status: 'Not charging', external_power: true })).battery
  assert.equal(paused.charging, false)
  assert.equal(paused.plugged, true)
  const discharging = (await home({ status: 'Discharging', external_power: true })).battery
  assert.equal(discharging.plugged, false)
  assert.equal((await home({ status: 'Charging' })).battery.plugged, true)
})

test('firmware is the ZTE build, kept separate from the kernel release', async () => {
  const device = (await load({ device: {
    kernel: 'Linux version 5.15.194-perf (builder) #1 SMP', firmware: 'XCBZ_HK_MU5250V1.0.0B04',
  } }).api.home()).device
  assert.equal(device.firmware, 'XCBZ_HK_MU5250V1.0.0B04')
  assert.equal(device.kernel, '5.15.194-perf')
})

// ── Primary carrier selection and measurement validation (PLAN2 R06) ───────────

// Sanitised shape based on HK B04 in 5G SA: the LTE measurement fields are ALSO
// populated, but the active band/channel are NR. Identifiers are synthetic.
const SA_LIVE = {
  network_type: 'SA', net_select: 'Only_5G', signalbar: '5', network_provider_fullname: 'Example Carrier',
  nr5g_pci: 745, nr5g_action_channel: 643392, nr5g_action_band: 'n78', nr5g_bandwidth: '100',
  nr5g_rsrp: -53, nr5g_rsrq: -11, nr5g_snr: '31.0', nr5g_rssi: -40, nr5g_cell_id: 305419896,
  lte_rsrp: -48, lte_rsrq: -7, lte_snr: '21.0', lte_rssi: -30,
  wan_active_band: 'n78', wan_active_channel: 643392, lte_pci: 12,
  lteca: '', ltecasig: '', nrca: '',
}

// Synthetic LTE-only attach.
const LTE_ONLY = {
  network_type: 'LTE', signalbar: '3', cell_id: 134479973,
  wan_active_band: 'B3', wan_active_channel: 1300, lte_pci: 0, lte_rsrp: -95, lte_rsrq: -12, lte_snr: '4.5', lte_rssi: -70,
  lteca: '0,3,x,1300,20;0,7,x,2850,10;', ltecasig: '-95,-12,4.5,-70', nr5g_action_band: '', nr5g_action_channel: 0, nr5g_rsrp: 0,
}

test('SA with populated LTE fields picks the NR PCC, never LTE', () => {
  const s = load().mapSignal(SA_LIVE)
  assert.equal(s.primary.rat, 'nr')
  assert.equal(s.primary.carrier.label, 'PCC')
  assert.equal(s.primary.carrier.band, 'n78')
  assert.equal(s.primary.carrier.rsrp, -53)
  assert.equal(s.primary.carrier.sinr, 31)
  assert.equal(s.primary.carrier.pci, 745)
  assert.equal(s.lte_carriers.length, 0, 'the NR active band is not mistaken for an LTE carrier')
  assert.equal(s.signal_bars, 5)
  assert.equal(s.cell_id, '12345678')
})

test('SA whose NR carrier is invalid has no primary even if LTE fields look valid', () => {
  const s = load().mapSignal({ ...SA_LIVE, nr5g_action_band: '', nr5g_action_channel: 0, wan_active_band: 'B3', wan_active_channel: 1300 })
  assert.equal(s.lte_carriers.length, 1)
  assert.equal(s.primary, undefined)
})

test('disconnected all-zero payload has no carriers and no primary', () => {
  const s = load().mapSignal({
    network_type: '', signalbar: '0', lte_rsrp: 0, lte_rsrq: 0, lte_snr: '0', lte_rssi: 0, lte_pci: 0,
    wan_active_band: '0', wan_active_channel: 0, nr5g_rsrp: 0, nr5g_rsrq: 0, nr5g_snr: '0', nr5g_pci: 0,
    nr5g_action_band: '0', nr5g_action_channel: 0, lteca: '', ltecasig: '', nrca: '',
  })
  assert.equal(s.lte_carriers.length, 0)
  assert.equal(s.nr_carriers.length, 0)
  assert.equal(s.primary, undefined)
  assert.equal(s.signal_bars, 0, 'a reported zero is a genuine zero')
  assert.equal('rsrp' in s, false, 'no raw rsrp fallback field remains on SignalInfo')
})

test('LTE-only picks the LTE PCC and keeps PCI 0', () => {
  const s = load().mapSignal(LTE_ONLY)
  assert.equal(s.primary.rat, 'lte')
  assert.equal(s.primary.carrier.band, 'B3')
  assert.equal(s.primary.carrier.pci, 0)
  assert.equal(s.primary.carrier.rsrp, -95)
  assert.equal(s.primary.carrier.sinr, 4.5)
  assert.equal(s.nr_carriers.length, 0)
  assert.equal(s.lte_carriers.length, 2, 'PCC (matched by PCI 0 + EARFCN, so not repeated) + one SCC with PCI 0')
  assert.equal(s.lte_carriers[1].pci, 0)
})

test('NSA/ENDC uses the LTE anchor PCC as primary and still lists the NR leg', () => {
  const nsa = { ...LTE_ONLY, network_type: 'ENDC', nr5g_pci: 301, nr5g_action_channel: 643392, nr5g_action_band: 'n78', nr5g_rsrp: -88, nr5g_rsrq: -12, nr5g_snr: '9' }
  for (const type of ['NSA', 'ENDC']) {
    const s = load().mapSignal({ ...nsa, network_type: type })
    assert.equal(s.primary.rat, 'lte', type)
    assert.equal(s.primary.carrier.rsrp, -95)
    assert.equal(s.nr_carriers[0].rsrp, -88)
  }
})

test('unrecognised network type picks a primary only when exactly one RAT is valid', () => {
  const m = load()
  assert.equal(m.mapSignal({ ...LTE_ONLY, network_type: undefined }).primary.rat, 'lte')
  assert.equal(m.mapSignal({ ...SA_LIVE, network_type: '5G' }).primary.rat, 'nr')
  const both = { ...SA_LIVE, network_type: '5G', wan_active_band: 'B3', wan_active_channel: 1300 }
  assert.equal(m.mapSignal(both).primary, undefined)
})

test('valid primary with a missing or placeholder RSRP stays neutral (undefined), not excellent', () => {
  const m = load()
  const missing = m.mapSignal({ ...LTE_ONLY, lte_rsrp: undefined })
  assert.equal(missing.primary.carrier.band, 'B3')
  assert.equal(missing.primary.carrier.rsrp, undefined)
  const zero = m.mapSignal({ ...LTE_ONLY, lte_rsrp: 0 })
  assert.equal(zero.primary.carrier.rsrp, undefined, 'RSRP 0 is the unmeasured placeholder')
  const poor = m.mapSignal({ ...LTE_ONLY, lte_rsrp: -121 })
  assert.equal(poor.primary.carrier.rsrp, -121, 'real poor readings are kept')
})

test('PCI 0 is valid and an absent or invalid PCI is never defaulted to 0', () => {
  const m = load()
  assert.equal(m.mapSignal({ ...SA_LIVE, nr5g_pci: 0 }).primary.carrier.pci, 0)
  assert.equal(m.mapSignal({ ...SA_LIVE, nr5g_pci: undefined }).primary.carrier.pci, undefined)
  assert.equal(m.mapSignal({ ...SA_LIVE, nr5g_pci: '' }).primary.carrier.pci, undefined)
  assert.equal(m.mapSignal({ ...SA_LIVE, nr5g_pci: 5000 }).primary.carrier.pci, undefined)
  assert.equal(m.mapSignal({ ...LTE_ONLY, lte_pci: undefined }).primary.carrier.pci, undefined)
  assert.equal(m.mapSignal({ ...LTE_ONLY, lte_pci: 504 }).primary.carrier.pci, undefined)
})

test('signal bars: missing stays undefined, a genuine zero stays 0, strings parse, junk is unknown', () => {
  const bars = (v) => load().mapSignal({ ...SA_LIVE, signalbar: v }).signal_bars
  assert.equal(bars(0), 0)
  assert.equal(bars('0'), 0)
  assert.equal(bars('4'), 4)
  assert.equal(bars(5), 5)
  assert.equal(bars(undefined), undefined)
  assert.equal(bars(''), undefined)
  assert.equal(bars(null), undefined)
  assert.equal(bars('abc'), undefined)
  assert.equal(bars('9'), undefined)
  assert.equal(bars(-1), undefined)
})

test('SINR of 0 is preserved on the primary; numeric strings and malformed strings are validated', () => {
  const m = load()
  assert.equal(m.mapSignal({ ...SA_LIVE, nr5g_snr: '0' }).primary.carrier.sinr, 0)
  assert.equal(m.mapSignal({ ...SA_LIVE, nr5g_snr: '-0.7' }).primary.carrier.sinr, -0.7)
  assert.equal(m.mapSignal({ ...SA_LIVE, nr5g_snr: '' }).primary.carrier.sinr, undefined)
  assert.equal(m.mapSignal({ ...SA_LIVE, nr5g_snr: 'N/A' }).primary.carrier.sinr, undefined)
  assert.equal(m.mapSignal({ ...SA_LIVE, nr5g_snr: '12dB' }).primary.carrier.sinr, undefined)
  assert.equal(m.mapSignal({ ...SA_LIVE, nr5g_rsrq: null }).primary.carrier.rsrq, undefined)
})

test('NR SCC PCI 0 is kept, the PCC is still excluded from SCCs, and idle floors stay suppressed', () => {
  const s = load().mapSignal({ ...SA_LIVE, nrca: '1,745,2,78,643392,100,1,-53,-11,31,-40;1,0,2,41,520110,20,1,-90,-12,5,-70;0,56,1,78,643392,60,1,-140.0,-43.0,-23.0,-120.0;' })
  assert.equal(s.nr_carriers.length, 3)
  assert.equal(s.nr_carriers[1].pci, 0)
  assert.equal(s.nr_carriers[1].rsrp, -90)
  assert.equal(s.nr_carriers[2].rsrp, undefined)
})

test('malformed string fields do not crash the mapper', () => {
  const s = load().mapSignal({ ...SA_LIVE, lteca: 5, ltecasig: {}, nrca: null, network_provider_fullname: '', network_provider: 'Fallback' })
  assert.equal(s.carrier, 'Fallback')
  assert.equal(s.primary.rat, 'nr')
})
