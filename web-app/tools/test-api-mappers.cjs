// Mapper validation for Wi-Fi, SMS, USB, APN, capabilities, charge control and TTL
// (PLAN2 A02/R09/R10/R13/R14). All fixtures are synthetic or a sanitised shape
// based on HK B04; no real identifiers, SMS content or credentials.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { loadTs } = require('./ts-loader.cjs')

function load(response = {}) {
  const client = {
    get: async () => response, post: async () => response, put: async () => response,
    req: async () => response, readCsv: async () => '',
  }
  return loadTs('data/api.ts', { stubs: { client } })
}
const m = load()

// ── Wi-Fi ──────────────────────────────────────────────────────────────────────

const WIFI = { // sanitised shape based on HK B04
  ssid_2g: 'ExampleNet', ssid_5g: 'ExampleNet-5G', radio2_disabled: '0', radio5_disabled: '0',
  channel_2g: '0', channel_5g: '36', htmode_2g: 'EHT40', htmode_5g: 'EHT80',
  actual_channel_2g: '6', actual_channel_5g: '36', actual_bw_2g: '40 MHz', actual_bw_5g: '80 MHz',
  txpower_2g: '80', txpower_5g: '25', wifi_onoff: '1', wifi_onoff_supported: true, wifi7_supported: true,
}

test('Wi-Fi TX power maps to a validated percentage per band', () => {
  const w = m.mapWifi(WIFI)
  assert.equal(w.band_2g.txpowerPercent, 80)
  assert.equal(w.band_5g.txpowerPercent, 25)
})

test('Wi-Fi TX power: unknown stays undefined; 0, 101, decimals and junk are rejected, 1 and 100 accepted', () => {
  const tx = (v) => m.mapWifi({ ...WIFI, txpower_2g: v }).band_2g.txpowerPercent
  assert.equal(tx(1), 1)
  assert.equal(tx('100'), 100)
  assert.equal(tx(60), 60)
  for (const bad of [0, '0', 101, 80.5, '', 'auto', null, undefined, -5, NaN]) assert.equal(tx(bad), undefined, String(bad))
  assert.equal(m.mapWifi({ ...WIFI, txpower_2g: undefined }).band_5g.txpowerPercent, 25, 'bands are independent')
})

test('Wi-Fi widths are normalised to MHz while raw strings are kept', () => {
  const w = m.mapWifi(WIFI)
  assert.equal(w.band_2g.configuredBandwidth, 'EHT40')
  assert.equal(w.band_2g.bandwidth, '40 MHz')
  assert.equal(w.band_2g.configuredWidthMhz, 40)
  assert.equal(w.band_2g.actualWidthMhz, 40)
  assert.equal(w.band_5g.configuredWidthMhz, 80)
  assert.equal(w.band_5g.actualWidthMhz, 80)
})

test('Wi-Fi width comparison: HE80 vs 80 MHz agree, HE80 vs 40 MHz differ, garbage is unknown', () => {
  const band = (htmode, actual) => m.mapWifi({ ...WIFI, htmode_5g: htmode, actual_bw_5g: actual }).band_5g
  const agree = band('HE80', '80 MHz')
  assert.equal(agree.configuredWidthMhz, agree.actualWidthMhz)
  const e160 = band('EHT160', '160 MHz')
  assert.equal(e160.configuredWidthMhz, e160.actualWidthMhz)
  const differ = band('HE80', '40 MHz')
  assert.notEqual(differ.configuredWidthMhz, differ.actualWidthMhz)
  const unknown = band('HE80', '')
  assert.equal(unknown.actualWidthMhz, undefined)
  assert.equal(unknown.configuredWidthMhz, 80)
  assert.equal(band('', 'wat').configuredWidthMhz, undefined)
})

test('Wi-Fi still maps existing fields (auto channel, actual channel, master switch)', () => {
  const w = m.mapWifi(WIFI)
  assert.equal(w.band_2g.configuredChannel, 'auto')
  assert.equal(w.band_5g.configuredChannel, '36')
  assert.equal(w.band_2g.channel, 6)
  assert.equal(w.master_supported, true)
  assert.equal(w.master_enabled, true)
  assert.equal(w.band_2g.enabled, true)
  assert.equal(m.mapWifi({ ...WIFI, radio2_disabled: '1' }).band_2g.enabled, false)
})

// ── SMS ────────────────────────────────────────────────────────────────────────

const SMS = (over = {}) => ({ id: 7, number: '+15550100', content: 'hello', date: '26,10,01,12,00,00,+0', tag: 1, mem_store: 1, ...over })

test('SMS list maps valid messages and decodes UCS-2 hex content', () => {
  const { messages, dropped } = m.mapSmsListResult({ messages: [SMS(), SMS({ id: 8, content: '00480069', tag: 2 })] })
  assert.equal(dropped, 0)
  assert.equal(messages.length, 2)
  assert.equal(messages[0].id, 7)
  assert.equal(messages[0].tag, 1)
  assert.equal(messages[1].content, 'Hi')
})

test('SMS entries without a valid id are dropped, never given id 0', () => {
  const { messages, dropped } = m.mapSmsListResult({
    messages: [SMS({ id: undefined }), SMS({ id: null }), SMS({ id: '' }), SMS({ id: 'abc' }), SMS({ id: -3 }), SMS({ id: 1.5 }), SMS({ id: 9 })],
  })
  assert.deepEqual(messages.map((x) => x.id), [9])
  assert.equal(dropped, 6)
})

test('SMS ids may be numeric strings and 0 is kept only when explicitly sent', () => {
  const { messages } = m.mapSmsListResult({ messages: [SMS({ id: '12' }), SMS({ id: 0 })] })
  assert.deepEqual(messages.map((x) => x.id), [12, 0])
})

test('SMS tag is validated (0-4); unknown, missing or malformed tags are dropped', () => {
  const { messages, dropped } = m.mapSmsListResult({
    messages: [SMS({ id: 1, tag: 0 }), SMS({ id: 2, tag: '2' }), SMS({ id: 3, tag: 9 }), SMS({ id: 4, tag: undefined }), SMS({ id: 5, tag: 'x' }), SMS({ id: 6, tag: null })],
  })
  assert.deepEqual(messages.map((x) => [x.id, x.tag]), [[1, 0], [2, 2]])
  assert.equal(dropped, 4)
})

test('SMS duplicate ids and non-object entries are dropped; first occurrence wins', () => {
  const { messages, dropped } = m.mapSmsListResult({ messages: [SMS({ id: 4, content: 'first' }), SMS({ id: 4, content: 'second' }), 'junk', null, 5] })
  assert.equal(messages.length, 1)
  assert.equal(messages[0].content, 'first')
  assert.equal(dropped, 4)
})

test('SMS list: a successful empty list is empty; a malformed payload throws instead of reading as empty', () => {
  assert.deepEqual(m.mapSmsListResult({ messages: [] }), { messages: [], dropped: 0 })
  assert.deepEqual(m.mapSmsListResult([]), { messages: [], dropped: 0 })
  assert.deepEqual(m.mapSmsListResult({}), { messages: [], dropped: 0 })
  assert.throws(() => m.mapSmsListResult({ messages: 'oops' }), /Malformed SMS/)
  assert.throws(() => m.mapSmsListResult(null), /Malformed SMS/)
  assert.throws(() => m.mapSmsListResult('x'), /Malformed SMS/)
  assert.equal(m.mapSmsList({ messages: [SMS()] }).length, 1)
})

// ── USB ────────────────────────────────────────────────────────────────────────

const USB = { // shape of agent/src/usb.rs::usb_status on a unit with NCM configfs present
  active_mode: 'ecm', default_mode: 'ecm', ncm_persist_on_boot: false,
  supported_modes: ['rndis', 'ecm', 'ncm'], experimental_modes: ['ncm'],
  mode_capabilities: [
    { mode: 'rndis', supported: true, experimental: false, function: 'gsi.rndis' },
    { mode: 'ecm', supported: true, experimental: false, function: 'gsi.ecm' },
    { mode: 'ncm', supported: true, experimental: true, function: 'ncm.0', note: 'configfs NCM exists' },
  ],
  composition_functions: ['gsi.ecm'], configfs: { present: true, ncm: true, gsi_ecm: true, gsi_rndis: true },
  bridge: { name: 'br-lan', members: ['ecm0', 'wlan0'] },
  interfaces: { ecm0: true, rndis0: false, ncm0: false, ncm_ifname: null }, usb_ids: { vendor: '19d2', product: '0001' },
  link: { negotiated: 'high-speed', negotiated_label: 'USB 2.0', negotiated_mbps: 480, max: 'super-speed', max_label: 'USB 3.0', max_mbps: 5000, at_full_speed: false },
  connect: 1, typec_cc: 'cc1', extra_unknown_field: { a: 1 },
}

test('USB status maps modes, capabilities and keeps boot default separate from active mode', () => {
  const s = m.mapUsbStatus({ ...USB, active_mode: 'ncm', default_mode: 'ecm', ncm_persist_on_boot: false })
  assert.equal(s.active_mode, 'ncm')
  assert.equal(s.default_mode, 'ecm')
  assert.equal(s.ncm_persist_on_boot, false)
  assert.deepEqual(s.supported_modes, ['rndis', 'ecm', 'ncm'])
  assert.deepEqual(s.mode_capabilities.map((c) => [c.mode, c.supported, c.experimental]), [['rndis', true, false], ['ecm', true, false], ['ncm', true, true]])
  assert.equal(s.link.negotiated_mbps, 480)
  assert.equal(s.link.at_full_speed, false)
  assert.equal(s.interfaces.ncm_ifname, null)
  assert.equal(s.connect, 1)
  assert.equal('extra_unknown_field' in s, false)
})

test('USB capabilities are authoritative: no Debug entry is invented, unsupported stays false', () => {
  const s = m.mapUsbStatus({ ...USB, mode_capabilities: [{ mode: 'ecm', supported: true }, { mode: 'ncm', supported: false, experimental: true }, { mode: 'debug', supported: true }] })
  assert.deepEqual(s.mode_capabilities.map((c) => c.mode), ['ecm', 'ncm'])
  assert.equal(s.mode_capabilities.find((c) => c.mode === 'ncm').supported, false)
})

test('USB capabilities: unreadable entries are dropped (never fabricated), absent list stays undefined', () => {
  const s = m.mapUsbStatus({ ...USB, mode_capabilities: [{ mode: 'ecm' }, { mode: 'rndis', supported: 'maybe' }, 5, null, { mode: 'ncm', supported: 1 }, { mode: 'ncm', supported: 0 }] })
  assert.deepEqual(s.mode_capabilities.map((c) => [c.mode, c.supported, c.experimental]), [['ncm', true, true]])
  assert.equal(m.mapUsbStatus({ ...USB, mode_capabilities: undefined }).mode_capabilities, undefined)
  assert.equal(m.mapUsbStatus({ ...USB, mode_capabilities: 'bad' }).mode_capabilities, undefined)
})

test('USB status with malformed fields degrades to unknown instead of crashing', () => {
  const s = m.mapUsbStatus({ active_mode: 'bogus', default_mode: 5, supported_modes: 'ecm', link: 'x', interfaces: [], connect: 'no' })
  assert.equal(s.active_mode, null)
  assert.equal(s.default_mode, undefined)
  assert.deepEqual(s.supported_modes, [])
  assert.equal(s.link, undefined)
  assert.equal(s.interfaces, undefined)
  assert.equal(s.connect, undefined)
  assert.equal(m.mapUsbStatus({}).active_mode, null)
  assert.equal(m.mapUsbStatus({ active_mode: 'RNDIS' }).active_mode, 'rndis')
})

test('USB mode result: a scheduled NCM switch is "scheduled", not applied', () => {
  const r = m.mapUsbModeResult({ status: 'scheduled', mode: 'ncm', experimental: true, delay_ms: 1000, rollback: 'reboot or switch back to ECM after reconnecting' })
  assert.equal(r.state, 'scheduled')
  assert.equal(r.mode, 'ncm')
  assert.equal(r.experimental, true)
  assert.equal(r.delayMs, 1000)
  assert.match(r.rollback, /ECM/)
})

test('USB mode result: scheduled ECM rollback; ubus passthrough is applied; unreadable scheduled data never throws', () => {
  const ecm = m.mapUsbModeResult({ status: 'scheduled', mode: 'ecm', delay_ms: 1000 })
  assert.deepEqual([ecm.state, ecm.mode, ecm.experimental, ecm.delayMs, 'rollback' in ecm], ['scheduled', 'ecm', false, 1000, false])
  const applied = m.mapUsbModeResult({ result: 0 })
  assert.deepEqual(applied, { state: 'applied', raw: { result: 0 } })
  assert.equal(m.mapUsbModeResult({}).state, 'applied')
  const odd = m.mapUsbModeResult({ status: 'scheduled', mode: 'debug', delay_ms: 'soon' })
  assert.deepEqual([odd.state, odd.mode, odd.delayMs], ['scheduled', null, null])
})

test('api.usbMode and api.usbStatus return mapped values', async () => {
  const scheduled = await load({ status: 'scheduled', mode: 'ncm', experimental: true, delay_ms: 1000 }).api.usbMode('ncm', { confirm_experimental: true })
  assert.equal(scheduled.state, 'scheduled')
  const status = await load(USB).api.usbStatus()
  assert.equal(status.active_mode, 'ecm')
})

// ── APN ────────────────────────────────────────────────────────────────────────

test('APN mode: 0 is auto, 1 is manual, missing or other values are unknown (never automatic)', () => {
  assert.deepEqual(m.mapApnMode({ apn_mode: 0 }), { mode: 'auto', raw: 0 })
  assert.deepEqual(m.mapApnMode({ apn_mode: 1 }), { mode: 'manual', raw: 1 })
  assert.deepEqual(m.mapApnMode({ apn_mode: '1' }), { mode: 'manual', raw: '1' })
  assert.deepEqual(m.mapApnMode({ apn_mode: '0' }), { mode: 'auto', raw: '0' })
  for (const raw of [undefined, null, '', 2, -1, 'auto', {}, NaN]) {
    assert.equal(m.mapApnMode({ apn_mode: raw }).mode, 'unknown', String(raw))
  }
  assert.equal(m.mapApnMode({}).mode, 'unknown')
  assert.equal(m.mapApnMode({}).raw, undefined)
})

const APN = (over = {}) => ({ profileId: 3, profilename: 'Example', wanapn: 'internet.example', username: '', password: '', pdpType: '3', pppAuthMode: 0, isEnable: 1, ...over })

test('APN profiles normalise firmware number/string/boolean encodings', () => {
  const list = m.mapApnProfiles({ apnListArray: [APN(), APN({ profileId: '4', isEnable: '0', pdpType: 1, pppAuthMode: '2' }), APN({ profileId: 5, isEnable: true })] })
  assert.deepEqual(list.map((p) => [p.profileId, p.isEnable, p.pdpType, p.pppAuthMode]), [['3', true, 3, 0], ['4', false, 1, 2], ['5', true, 3, 0]])
})

test('APN profiles: unusable entries are dropped, unreadable numbers are null, unknown fields ignored', () => {
  const list = m.mapApnProfiles({ apnListArray: [APN({ profileId: undefined }), APN({ profileId: '' }), null, 'x', APN({ profileId: 8, pdpType: 'wat', pppAuthMode: null, isEnable: 'maybe', extra: 1 }), APN({ profileId: 8 })] })
  assert.equal(list.length, 1)
  assert.deepEqual([list[0].profileId, list[0].pdpType, list[0].pppAuthMode, list[0].isEnable], ['8', null, null, false])
  assert.equal('extra' in list[0], false)
})

test('APN profiles: empty and absent lists are empty; a non-array list throws', () => {
  assert.deepEqual(m.mapApnProfiles({ apnListArray: [] }), [])
  assert.deepEqual(m.mapApnProfiles({}), [])
  assert.deepEqual(m.mapApnProfiles({ apnListArray: null }), [])
  assert.throws(() => m.mapApnProfiles({ apnListArray: 'x' }), /Malformed APN/)
})

// ── Capabilities, charge control, TTL ──────────────────────────────────────────

test('modem capabilities are validated and never invent bands', () => {
  const c = m.mapModemCapabilities({
    network_modes: [{ value: 'Only_5G', label: '5G SA' }, { value: 'X' }, { label: 'no value' }, 7],
    lte_bands: [3, 1, '8', 'x', null, 3], nr_sa_bands: [78, 41], nr_nsa_band_lock_supported: false, extra: true,
  })
  assert.deepEqual(c.network_modes, [{ value: 'Only_5G', label: '5G SA' }, { value: 'X', label: 'X' }])
  assert.deepEqual(c.lte_bands, [1, 3, 8])
  assert.deepEqual(c.nr_sa_bands, [41, 78])
  assert.equal(c.nr_nsa_band_lock_supported, false)
  const empty = m.mapModemCapabilities({})
  assert.deepEqual([empty.network_modes, empty.lte_bands, empty.nr_sa_bands, empty.nr_nsa_band_lock_supported], [[], [], [], false])
})

const CHARGE = {
  available: true, battery_available: true, charger_available: true, charging_stopped: false, battery_status: 'Charging',
  capacity: 80, charge_limit_enabled: true, charge_limit: 80, hysteresis: 5, manual_override: false, last_error: null,
}

test('charge control maps a good payload and keeps null/false/zero distinct', () => {
  const c = m.mapChargeControl({ ...CHARGE, charging_stopped: null, capacity: 0, charge_limit_enabled: false, extra: 1 })
  assert.equal(c.charging_stopped, null)
  assert.equal(c.capacity, 0)
  assert.equal(c.charge_limit_enabled, false)
  assert.equal(c.charge_limit, 80)
  assert.equal(c.last_error, null)
  assert.equal('extra' in c, false)
  assert.equal(m.mapChargeControl({ ...CHARGE, last_error: 'boom' }).last_error, 'boom')
})

test('charge control: unreadable availability is false, unreadable controls reject the payload', () => {
  const c = m.mapChargeControl({ ...CHARGE, available: 'x', charger_available: undefined, battery_status: 5, capacity: 'n/a' })
  assert.equal(c.available, false)
  assert.equal(c.charger_available, false)
  assert.equal(c.battery_status, null)
  assert.equal(c.capacity, null)
  assert.throws(() => m.mapChargeControl({ ...CHARGE, charge_limit: 'x' }), /Malformed charge/)
  assert.throws(() => m.mapChargeControl({ ...CHARGE, hysteresis: undefined }), /Malformed charge/)
  assert.throws(() => m.mapChargeControl({ ...CHARGE, charge_limit_enabled: undefined }), /Malformed charge/)
  assert.throws(() => m.mapChargeControl({}), /Malformed charge/)
})

test('TTL status keeps unknown distinct from disabled', () => {
  assert.deepEqual(m.mapTtlStatus({ active: true, ipv6_active: false, ttl_value: 65 }), { active: true, ipv6_active: false, ttl_value: 65 })
  const unknown = m.mapTtlStatus({ active: 'maybe', ttl_value: 'x' })
  assert.equal(unknown.active, undefined)
  assert.equal(unknown.ipv6_active, undefined)
  assert.equal(unknown.ttl_value, undefined)
  assert.equal(m.mapTtlStatus({ ttl_value: 300 }).ttl_value, undefined)
  assert.equal(m.mapTtlStatus({ ttl_value: 0 }).ttl_value, 0)
})

// ── Home batch integration ─────────────────────────────────────────────────────

test('home maps usage with null counters and unknown reset configuration', async () => {
  const home = await load({
    data_usage: { day: { rx_bytes: null, tx_bytes: null, time_secs: null }, month: { rx_bytes: 0, tx_bytes: 0, time_secs: 0 }, total: {}, reset_day: null, reset_enabled: null, clear_date_record: null, next_clear_date: null },
  }).api.home()
  assert.equal(home.usage.day.rx_bytes, null)
  assert.equal(home.usage.month.rx_bytes, 0)
  assert.equal(home.usage.total.tx_bytes, null)
  assert.equal(home.usage.reset_enabled, null)
  assert.equal(home.usage.reset_day, null)
})
