const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Loads api.ts with a stubbed client so mappers run against raw agent payloads.
function load(response = {}) {
  const client = {
    get: async () => response, post: async () => response, put: async () => response,
    req: async () => response, readCsv: async () => '',
  }
  const context = { exports: {}, require: () => client, BigInt }
  const source = fs.readFileSync(path.join(__dirname, '../src/data/api.ts'), 'utf8')
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText, context)
  return context.exports
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
