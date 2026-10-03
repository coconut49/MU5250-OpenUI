// Wi-Fi and Clients view logic (PLAN2 R03, R07, R09, R11, R13, U07). Pure modules only.
// Fixtures are synthetic.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { loadTs } = require('./ts-loader.cjs')

const draftMod = loadTs('features/network/wifiDraft.ts')
const advice = loadTs('features/network/wifiAdvice.ts')
const confirmMod = loadTs('features/network/wifiConfirm.ts')
const clientsView = loadTs('features/network/clientsView.ts')
const api = loadTs('data/api.ts', {
  stubs: { client: { get: async () => ({}), post: async () => ({}), put: async () => ({}), req: async () => ({}), readCsv: async () => '' } },
})

const raw = (over = {}) => ({
  wifi_onoff: '1', wifi_onoff_supported: true, radio2_disabled: '0', radio5_disabled: '0',
  channel_2g: '0', channel_5g: '44', actual_channel_2g: 6, actual_channel_5g: 44,
  actual_bw_2g: '40 MHz', actual_bw_5g: '80 MHz', htmode_2g: 'EHT40', htmode_5g: 'EHT80',
  bandwidth_options_2g: ['EHT20', 'EHT40'], bandwidth_options_5g: ['EHT20', 'EHT40', 'EHT80', 'EHT160'],
  txpower_2g: '80', txpower_5g: '25', ssid_2g: 'Synthetic-WiFi', ssid_5g: 'Synthetic-WiFi',
  key_2g: 'oldpassword', key_5g: 'oldpassword', has_key_2g: true, has_key_5g: true,
  encryption_2g: 'psk3-mixed', encryption_5g: 'psk3-mixed', hidden_2g: '0', hidden_5g: '0',
  clients_2g: 1, clients_5g: 2, ...over,
})
const wifi = (over) => api.mapWifi(raw(over))
const band2 = (over) => wifi(over).band_2g
const band5 = (over) => wifi(over).band_5g

// ── R09 TX power ──────────────────────────────────────────────────────────────

test('an observed TX power initialises the draft (25% reopens as 25, 80% as 80)', () => {
  assert.equal(draftMod.draftFromBand(band5()).txpower, '25')
  assert.equal(draftMod.draftFromBand(band2()).txpower, '80')
})

test('unknown or invalid observed TX power stays unknown (blank), never 100 or a default', () => {
  assert.equal(draftMod.draftFromBand(band2({ txpower_2g: '' })).txpower, '')
  assert.equal(draftMod.draftFromBand(band2({ txpower_2g: '0' })).txpower, '')
  assert.equal(draftMod.draftFromBand(band2({ txpower_2g: '101' })).txpower, '')
  assert.equal(draftMod.draftFromBand(band2({ txpower_2g: 'full' })).txpower, '')
})

test('parseTxPower accepts integers 1-100 and rejects 0, 101, decimals and junk', () => {
  for (const ok of ['1', '25', '60', '100', ' 75 ', '025']) {
    const r = draftMod.parseTxPower(ok)
    assert.equal(r.ok, true, ok)
    assert.equal(r.value, Number(ok.trim()))
  }
  assert.deepEqual(draftMod.parseTxPower(''), { ok: true, value: null }, 'blank means keep current')
  for (const bad of ['0', '101', '25.5', '-5', '+5', '1e2', 'abc', '1000', '００']) {
    assert.equal(draftMod.parseTxPower(bad).ok, false, bad)
  }
})

test('an unrelated save omits txpower; an unchanged txpower is omitted too', () => {
  const base = draftMod.draftFromBand(band2())
  const patch = draftMod.buildBandPatch('2g', { ...base, ssid: 'Other' }, base)
  assert.deepEqual({ ...patch }, { ssid_2g: 'Other' })
  const same = draftMod.buildBandPatch('2g', { ...base, txpower: '080' }, base)
  assert.deepEqual({ ...same }, {})
})

test('explicit 100 sends the number 100 under the band suffix; each band is independent', () => {
  const b2 = draftMod.draftFromBand(band2())
  const b5 = draftMod.draftFromBand(band5())
  assert.deepEqual({ ...draftMod.buildBandPatch('2g', { ...b2, txpower: '100' }, b2) }, { txpower_2g: 100 })
  assert.deepEqual({ ...draftMod.buildBandPatch('5g', { ...b5, txpower: '60' }, b5) }, { txpower_5g: 60 })
})

test('blank (keep current) never sends txpower; unknown baseline with a typed value sends it', () => {
  const unknown = draftMod.draftFromBand(band2({ txpower_2g: '' }))
  assert.deepEqual({ ...draftMod.buildBandPatch('2g', { ...unknown, ssid: 'X' }, unknown) }, { ssid_2g: 'X' })
  assert.deepEqual({ ...draftMod.buildBandPatch('2g', { ...unknown, txpower: '100' }, unknown) }, { txpower_2g: 100 })
})

test('an invalid TX draft is reported and never enters the patch', () => {
  const base = draftMod.draftFromBand(band2())
  for (const bad of ['0', '101', '12.5']) {
    const draft = { ...base, txpower: bad }
    assert.ok(draftMod.validateDraft(draft, base).txpower, bad)
    assert.equal('txpower_2g' in draftMod.buildBandPatch('2g', draft, base), false)
  }
})

test('mapWifi keeps the two bands TX power separate', () => {
  assert.equal(band2().txpowerPercent, 80)
  assert.equal(band5().txpowerPercent, 25)
})

// ── R03 drafts ────────────────────────────────────────────────────────────────

test('an equivalent observation returns the same state object (re-read is not a change)', () => {
  const s = draftMod.initDraft(draftMod.draftFromBand(band5()))
  assert.equal(draftMod.reconcileDraft(s, draftMod.draftFromBand(band5())), s)
  // clients / actual channel are not editable fields, so they never reach the draft
  assert.equal(draftMod.reconcileDraft(s, draftMod.draftFromBand(band5({ clients_5g: 9, actual_channel_5g: 149 }))), s)
})

test('a pristine draft follows the device', () => {
  const s = draftMod.initDraft(draftMod.draftFromBand(band5()))
  const next = draftMod.reconcileDraft(s, draftMod.draftFromBand(band5({ ssid_5g: 'Renamed' })))
  assert.equal(next.draft.ssid, 'Renamed')
  assert.equal(next.base.ssid, 'Renamed')
  assert.equal(next.conflict, false)
})

test('a dirty 5 GHz draft survives a re-read that changed only 2.4 GHz', () => {
  let s5 = draftMod.initDraft(draftMod.draftFromBand(band5()))
  s5 = draftMod.editDraft(draftMod.startEditing(s5), { ssid: 'My5GHz' })
  const afterSave = wifi({ ssid_2g: 'New24' }) // 2.4 GHz saved and re-read
  const next = draftMod.reconcileDraft(s5, draftMod.draftFromBand(afterSave.band_5g))
  assert.equal(next, s5)
  assert.equal(next.draft.ssid, 'My5GHz')
})

test('a real external change keeps a dirty draft, flags a conflict, and Reload/Cancel restore the observation', () => {
  let s = draftMod.initDraft(draftMod.draftFromBand(band5()))
  s = draftMod.editDraft(draftMod.startEditing(s), { ssid: 'Mine' })
  const next = draftMod.reconcileDraft(s, draftMod.draftFromBand(band5({ ssid_5g: 'Theirs' })))
  assert.equal(next.draft.ssid, 'Mine')
  assert.equal(next.base.ssid, 'Theirs')
  assert.equal(next.conflict, true)
  assert.equal(draftMod.reloadDraft(next).draft.ssid, 'Theirs')
  assert.equal(draftMod.reloadDraft(next).conflict, false)
  assert.equal(draftMod.reloadDraft(next).editing, true)
  const cancelled = draftMod.cancelDraft(next)
  assert.deepEqual([cancelled.editing, cancelled.conflict, cancelled.draft.ssid], [false, false, 'Theirs'])
})

test('a dirty draft that now equals the device is not a conflict', () => {
  let s = draftMod.initDraft(draftMod.draftFromBand(band5()))
  s = draftMod.editDraft(draftMod.startEditing(s), { ssid: 'Same' })
  const next = draftMod.reconcileDraft(s, draftMod.draftFromBand(band5({ ssid_5g: 'Same' })))
  assert.equal(next.conflict, false)
  assert.equal(draftMod.isDirty(next), false)
})

test('dirty is semantic: editing back to the observed value is pristine', () => {
  let s = draftMod.initDraft(draftMod.draftFromBand(band5()))
  s = draftMod.editDraft(s, { ssid: 'X' })
  assert.equal(draftMod.isDirty(s), true)
  s = draftMod.editDraft(s, { ssid: 'Synthetic-WiFi', txpower: '025' })
  assert.equal(draftMod.isDirty(s), false)
})

test('the password is sent only when its text changed', () => {
  const base = draftMod.draftFromBand(band2())
  assert.equal('key_2g' in draftMod.buildBandPatch('2g', { ...base, ssid: 'A' }, base), false)
  assert.deepEqual({ ...draftMod.buildBandPatch('2g', { ...base, password: 'brand-new-pass' }, base) }, { key_2g: 'brand-new-pass' })
})

test('validation mirrors the agent: SSID 1-32 bytes without shell characters, password 8-63 or 64 hex', () => {
  const base = draftMod.draftFromBand(band2())
  const v = (over, security) => draftMod.validateDraft({ ...base, ...over }, base, security)
  assert.ok(v({ ssid: '' }).ssid)
  assert.ok(v({ ssid: 'a'.repeat(33) }).ssid)
  assert.ok(v({ ssid: 'it"s' }).ssid)
  assert.equal(v({ ssid: 'a'.repeat(32) }).ssid, undefined)
  assert.ok(v({ password: 'short' }).password)
  assert.equal(v({ password: 'longenough1' }).password, undefined)
  assert.equal(v({ password: 'a'.repeat(64) }).password, undefined)
  assert.ok(v({ password: 'g'.repeat(64) }).password)
  assert.equal(v({ password: 'x' }, 'none').password, undefined, 'open networks have no password rule')
  assert.equal(draftMod.hasErrors(v({})), false)
})

test('the channel and width fields are sent only when changed', () => {
  const base = draftMod.draftFromBand(band5())
  assert.deepEqual({ ...draftMod.buildBandPatch('5g', { ...base, channel: '36', htmode: 'EHT160' }, base) }, { channel_5g: '36', htmode_5g: 'EHT160' })
  assert.deepEqual({ ...draftMod.buildBandPatch('5g', { ...base, hidden: true }, base) }, { hidden_5g: '1' })
})

// ── R11 confirmations, verification ──────────────────────────────────────────

test('buildSyncPatch copies SSID, hidden and security, and the password only when readable', () => {
  const src = band2()
  const r = draftMod.buildSyncPatch(src, '5g')
  assert.equal(r.includePassword, true)
  assert.deepEqual({ ...r.patch }, { ssid_5g: 'Synthetic-WiFi', hidden_5g: '0', encryption_5g: 'psk3-mixed', key_5g: 'oldpassword' })
  const masked = draftMod.buildSyncPatch(band2({ key_2g: '' }), '5g')
  assert.equal(masked.includePassword, false)
  assert.equal('key_5g' in masked.patch, false)
  assert.deepEqual(draftMod.buildSyncPatch(band2({ ssid_2g: '' }), '5g'), { error: 'source SSID is empty' })
  assert.ok(Object.isFrozen(r.patch), 'the reviewed payload is frozen')
})

test('built patches are frozen so a later edit cannot change a reviewed payload', () => {
  const base = draftMod.draftFromBand(band2())
  assert.ok(Object.isFrozen(draftMod.buildBandPatch('2g', { ...base, ssid: 'A' }, base)))
})

test('confirmations are connection-kind, name the band, state the effect and a recovery, and never include a password', () => {
  const secret = 'hunter2-synthetic'
  const base = band2()
  const patch = draftMod.buildBandPatch('2g', { ...draftMod.draftFromBand(base), ssid: 'Fresh', password: secret, channel: '11' }, draftMod.draftFromBand(base))
  const sync = draftMod.buildSyncPatch(band5({ key_5g: secret }), '2g')
  const specs = [
    confirmMod.masterOffConfirm(),
    confirmMod.radioOffConfirm('5 GHz', '2.4 GHz'),
    confirmMod.bandSaveConfirm('2.4 GHz', '5 GHz', patch, base),
    confirmMod.syncConfirm('5 GHz', '2.4 GHz', sync.patch, base, sync.includePassword),
  ]
  for (const spec of specs) {
    assert.equal(spec.kind, 'connection')
    assert.match(spec.consequence, /possibly this browser/)
    assert.match(spec.consequence, /Mobile data/)
    assert.ok(spec.recovery.length > 10)
    assert.equal(JSON.stringify(spec).includes(secret), false, spec.title)
  }
  assert.match(specs[1].title, /5 GHz/)
  assert.match(specs[1].recovery, /2\.4 GHz/)
  assert.deepEqual(specs[2].details, [
    { label: 'Band', value: '2.4 GHz' },
    { label: 'SSID', value: 'Synthetic-WiFi → Fresh' },
    { label: 'Password', value: 'Changed (not shown)' },
    { label: 'Channel', value: 'Auto → 11' },
  ])
  assert.match(specs[3].details.at(-1).value, /Copied/)
})

test('verifyApplied compares the requested values with a fresh read and skips passwords', () => {
  const fresh = wifi({ ssid_5g: 'Fresh', txpower_5g: '100', radio2_disabled: '1', wifi_onoff: '0' })
  assert.deepEqual(draftMod.verifyApplied({ ssid_5g: 'Fresh', txpower_5g: 100 }, fresh), { kind: 'verified', checked: 2 })
  assert.deepEqual(draftMod.verifyApplied({ radio2_disabled: '1' }, fresh), { kind: 'verified', checked: 1 })
  assert.deepEqual(draftMod.verifyApplied({ wifi_onoff: '0' }, fresh), { kind: 'verified', checked: 1 })
  assert.deepEqual(draftMod.verifyApplied({ ssid_5g: 'Other' }, fresh), { kind: 'mismatch', fields: ['SSID'] })
  assert.deepEqual(draftMod.verifyApplied({ key_5g: 'longenough1' }, fresh), { kind: 'unchecked' })
  assert.deepEqual(draftMod.verifyApplied({ channel_2g: '0' }, fresh), { kind: 'verified', checked: 1 }, 'auto channel is 0 or auto')
})

test('a failure with no HTTP status is uncertain; one with a status is a definite rejection', () => {
  const noReply = Object.assign(new Error('Failed to reach the agent'), { status: undefined })
  const rejected = Object.assign(new Error('txpower_2g is outside the supported values'), { status: 400 })
  assert.equal(draftMod.isUncertainFailure(noReply), true)
  assert.equal(draftMod.isUncertainFailure(rejected), false)
  assert.equal(draftMod.isUncertainFailure('string'), false)
})

// ── R13 advice ────────────────────────────────────────────────────────────────

test('width comparison is numeric: HE80 vs 80 MHz and EHT80 vs 80 agree, HE80 vs 40 differs', () => {
  const adv = (configured, actual) => advice.getBandInsights('5g', band5({ htmode_5g: configured, actual_bw_5g: actual, channel_5g: '44' }))
  assert.equal(adv('HE80', '80 MHz').some((t) => /width/i.test(t)), false)
  assert.equal(adv('EHT80', '80 MHz').some((t) => /width/i.test(t)), false)
  assert.equal(adv('EHT160', '160 MHz').some((t) => /width/i.test(t)), false)
  const differ = adv('HE80', '40 MHz').filter((t) => /width/i.test(t))
  assert.equal(differ.length, 1)
  assert.match(differ[0], /Configured width is 80 MHz.*currently operating at 40 MHz/)
})

test('missing or malformed runtime width and unknown configured width never warn', () => {
  const adv = (configured, actual) => advice.getBandInsights('5g', band5({ htmode_5g: configured, actual_bw_5g: actual, channel_5g: '44' }))
  for (const [c, a] of [['HE80', ''], ['HE80', 'wide'], ['', '80 MHz'], ['auto', '80 MHz'], ['HE80', '80+80 MHz']]) {
    assert.deepEqual(adv(c, a), [], `${c} / ${a}`)
  }
})

test('there is no "no conflicts" claim and no client-count advice', () => {
  const crowded = advice.getBandInsights('5g', band5({ clients_5g: 40, channel_5g: '44' }))
  assert.deepEqual(crowded, [], 'an ordinary fixed channel with no differences produces no advice at all')
  const all = [
    ...advice.getBandInsights('2g', band2({ channel_2g: '3', clients_2g: 40 })),
    ...advice.getBandInsights('5g', band5({ channel_5g: '100', clients_5g: 40 })),
  ].join(' ')
  assert.doesNotMatch(all, /no obvious|no conflict|client count|improve stability/i)
})

test('automatic channel, differing channel and DFS stay factual', () => {
  const auto = advice.getBandInsights('2g', band2())
  assert.deepEqual(auto, ['Automatic channel selection is currently using channel 6.'])
  const moved = advice.getBandInsights('5g', band5({ channel_5g: '100', actual_channel_5g: 36 }))
  assert.ok(moved.some((t) => /Configured channel is 100; the radio is currently on channel 36/.test(t)))
  assert.ok(moved.some((t) => /DFS/.test(t)))
  const overlap = advice.getBandInsights('2g', band2({ channel_2g: '3', actual_channel_2g: 3 }))
  assert.equal(overlap.length, 1)
  assert.match(overlap[0], /No scan of nearby networks was run/)
})

// ── U07 / R07 clients ─────────────────────────────────────────────────────────

test('groupClients puts every client in exactly one group, including unknown media', () => {
  const c = (medium, mac) => ({ mac, medium })
  const g = clientsView.groupClients([c('wifi', '1'), c('usb-c', '2'), c('ethernet', '3'), c('wired', '4'), c(undefined, '5'), c('bluetooth', '6')])
  assert.deepEqual([g.wifi.length, g.usb.length, g.ethernet.length, g.other.length], [1, 1, 1, 3])
})

test('the stacked mobile row carries every field the desktop table shows', () => {
  const wifiClient = { mac: '02:00:5E:00:00:01', ip: '2001:db8::1234', signal_dbm: -42, tx_bitrate_mbps: 2401.9, rx_bitrate_mbps: 2401.9 }
  assert.deepEqual(clientsView.clientFields('wifi', wifiClient).map((f) => [f.label, f.value]), [
    ['IP', '2001:db8::1234'], ['Signal', '-42 dBm'], ['Link', 'TX 2402 / RX 2402 Mbps'], ['MAC', '02:00:5E:00:00:01'],
  ])
  assert.deepEqual(clientsView.clientFields('usb', { mac: 'm', ip: '192.0.2.4', interface: 'ncm0' }).map((f) => f.label), ['IP', 'Interface', 'MAC'])
  assert.deepEqual(clientsView.clientFields('ethernet', { mac: 'm', wired_link_mbps: 1000 }).map((f) => [f.label, f.value]), [
    ['IP', undefined], ['Speed', '1000 Mbps'], ['MAC', 'm'],
  ])
  assert.deepEqual(clientsView.clientFields('other', { mac: 'm', ip: 'i' }).map((f) => f.label), ['IP', 'MAC'])
})

test('missing or non-positive rates are unavailable, never "0 Mbps"', () => {
  assert.equal(clientsView.formatLinkMbps(0), undefined)
  assert.equal(clientsView.formatLinkMbps(undefined), undefined)
  assert.equal(clientsView.formatLinkMbps(NaN), undefined)
  assert.equal(clientsView.formatBitrate(5000), '5 Gbit/s')
  assert.equal(clientsView.formatBitrate(480), '480 Mbit/s')
  assert.equal(clientsView.formatWifiLink({ mac: 'm' }), undefined)
})
