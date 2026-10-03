// Modem-page presentation logic (PLAN2 R04/R05/R07/R08/R11/R14/U03): cycle/reset text, reset-day
// validation, TTL interpretation, APN draft/confirm decisions, SMS collection helpers.
// Fixtures are synthetic.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { loadTs } = require('./ts-loader.cjs')
const usage = loadTs('features/modem/usageView.ts')
const ttl = loadTs('features/modem/ttlView.ts')
const apn = loadTs('features/modem/apnState.ts')
const sms = loadTs('features/modem/smsCollection.ts')

const U = (over = {}) => ({
  reset_enabled: true,
  reset_day: 16,
  cycle_start: { year: 2026, month: 9, day: 16 },
  next_reset: { year: 2026, month: 10, day: 16 },
  ...over,
})

// ── Cycle / reset presentation ────────────────────────────────────────────────

test('enabled reset shows device dates and a next reset', () => {
  const v = usage.cycleView(U())
  assert.equal(v.state, 'enabled')
  assert.equal(v.headline, null)
  assert.equal(v.cycleStart, '16 Sep 2026')
  assert.equal(v.showNextReset, true)
  assert.equal(v.nextReset, '16 Oct 2026')
  assert.equal(v.resetDay, '16')
})

test('disabled reset says so and makes no next-reset claim even if the device sent a date', () => {
  const v = usage.cycleView(U({ reset_enabled: false }))
  assert.equal(v.state, 'disabled')
  assert.equal(v.headline, 'Automatic reset disabled')
  assert.equal(v.showNextReset, false)
  assert.equal(v.nextReset, null)
  assert.match(v.note, /no reset is scheduled/)
})

test('unknown enablement stays unknown, not disabled and not enabled', () => {
  const v = usage.cycleView(U({ reset_enabled: null, reset_day: null }))
  assert.equal(v.state, 'unknown')
  assert.equal(v.stateLabel, 'Unknown')
  assert.equal(v.headline, 'Automatic reset status unknown')
  assert.equal(v.showNextReset, false)
  assert.equal(v.resetDay, null)
})

test('missing or invalid device dates are unavailable, never estimated', () => {
  const v = usage.cycleView(U({ cycle_start: null, next_reset: { year: 2026, month: 2, day: 31 } }))
  assert.equal(v.cycleStart, null)
  assert.equal(v.nextReset, null)
  assert.equal(usage.cycleView(U({ cycle_start: undefined, next_reset: undefined })).cycleStart, null)
})

test('resetState treats absent usage as unknown', () => {
  assert.equal(usage.resetState(null), 'unknown')
  assert.equal(usage.resetState({ reset_enabled: false }), 'disabled')
})

// ── Reset-day input ───────────────────────────────────────────────────────────

test('parseResetDay accepts 1-31 whole numbers only', () => {
  for (const ok of ['1', '16', '31', ' 7 ', '07']) assert.equal(usage.parseResetDay(ok).ok, true, ok)
  assert.equal(usage.parseResetDay('07').day, 7)
  for (const bad of ['', '0', '32', '-1', '1.5', '1e1', 'abc', '100', '+5', ' ']) {
    assert.equal(usage.parseResetDay(bad).ok, false, JSON.stringify(bad))
  }
})

test('saving a reset day warns it also turns automatic reset on unless already enabled', () => {
  const on = usage.resetDayCopy('enabled')
  assert.equal(on.turnsOn, false)
  assert.equal(on.button, 'Save')
  for (const s of ['disabled', 'unknown']) {
    const c = usage.resetDayCopy(s)
    assert.equal(c.turnsOn, true)
    assert.match(c.hint, /turns automatic reset on/)
    assert.match(c.button, /turn on automatic reset/)
  }
})

// ── TTL ───────────────────────────────────────────────────────────────────────

test('TTL state: unreadable fields are unknown, not disabled', () => {
  assert.equal(ttl.ttlState(null), 'unknown')
  assert.equal(ttl.ttlState({}), 'unknown')
  assert.equal(ttl.ttlState({ active: false }), 'unknown')
  assert.equal(ttl.ttlState({ active: false, ipv6_active: false, ttl_value: 0 }), 'inactive')
  assert.equal(ttl.ttlState({ active: true }), 'active')
  assert.equal(ttl.ttlState({ active: false, ipv6_active: true }), 'active')
})

test('TTL families chip names which IP versions are clamped', () => {
  assert.equal(ttl.ttlFamilies({ active: true, ipv6_active: true }), 'IPv4 + IPv6')
  assert.equal(ttl.ttlFamilies({ active: true, ipv6_active: false }), 'IPv4 only')
  assert.equal(ttl.ttlFamilies({ active: false, ipv6_active: true }), 'IPv6 only')
  assert.equal(ttl.ttlFamilies({ active: false, ipv6_active: false }), null)
})

test('TTL input shows the draft, then the observed value, then the usual 65', () => {
  assert.equal(ttl.ttlInputValue('12', { ttl_value: 64 }), '12')
  assert.equal(ttl.ttlInputValue('', { ttl_value: 64 }), '', 'an emptied draft stays empty')
  assert.equal(ttl.ttlInputValue(null, { ttl_value: 64 }), '64')
  assert.equal(ttl.ttlInputValue(null, { ttl_value: 0 }), '65')
  assert.equal(ttl.ttlInputValue(null, null), '65')
})

test('parseTtl accepts 1-255 whole numbers only', () => {
  assert.deepEqual(ttl.parseTtl('65'), { ok: true, ttl: 65 })
  assert.equal(ttl.parseTtl('255').ok, true)
  for (const bad of ['', '0', '256', '1.5', '-3', 'x', '1000']) assert.equal(ttl.parseTtl(bad).ok, false, bad)
})

// ── APN ───────────────────────────────────────────────────────────────────────

test('APN mode draft: Apply only for a draft that differs from the observed mode', () => {
  assert.equal(apn.canApplyMode(null, 'manual'), false)
  assert.equal(apn.canApplyMode('manual', 'manual'), false)
  assert.equal(apn.canApplyMode('auto', 'manual'), true)
  assert.equal(apn.canApplyMode('auto', 'unknown'), true, 'unknown baseline: any explicit choice can be applied')
  assert.equal(apn.shownMode(null, 'manual'), 'manual')
  assert.equal(apn.shownMode('auto', 'manual'), 'auto')
  assert.equal(apn.shownMode(null, 'unknown'), 'unknown')
})

test('APN mode wire values and accepted state', () => {
  assert.equal(apn.modeWire('auto'), 0)
  assert.equal(apn.modeWire('manual'), 1)
  assert.deepEqual(apn.modeState('manual'), { mode: 'manual', raw: 1 })
})

test('mode-change confirmation is a connection confirmation that explains the reconnect', () => {
  const c = apn.modeChangeConfirm('manual', 'auto')
  assert.equal(c.kind, 'connection')
  assert.deepEqual(c.details, [{ label: 'APN mode', value: 'Automatic → Manual' }])
  assert.match(c.consequence, /Mobile data reconnects/)
  assert.match(c.consequence, /dashboard should stay reachable/)
  assert.ok(c.recovery)
  assert.deepEqual(apn.modeChangeConfirm('auto', 'unknown').details, [{ label: 'APN mode', value: 'Automatic' }])
})

test('activation confirmation never carries credentials and notes the manual-mode switch', () => {
  const profile = { profilename: 'Synthetic Internet', wanapn: 'internet.example', username: 'syn-user', password: 'syn-secret-pass' }
  for (const observed of ['auto', 'manual', 'unknown']) {
    const c = apn.activationConfirm(profile, observed)
    const text = JSON.stringify(c)
    assert.ok(!text.includes('syn-secret-pass'), 'password')
    assert.ok(!text.includes('syn-user'), 'username')
    assert.equal(c.kind, 'connection')
    assert.ok(text.includes('internet.example'))
  }
  assert.match(apn.activationConfirm(profile, 'auto').consequence, /switches APN mode to manual/)
  assert.doesNotMatch(apn.activationConfirm(profile, 'manual').consequence, /switches APN mode/)
})

test('read-back outcome keeps each source independently and flags a failed one', () => {
  const ok = (value) => ({ status: 'fulfilled', value })
  const bad = { status: 'rejected', reason: new Error('x') }
  const mode = { mode: 'manual', raw: 1 }
  assert.deepEqual(apn.readBackOutcome(ok(mode), ok([])), { mode, profiles: [], failed: false })
  assert.deepEqual(apn.readBackOutcome(ok(mode), bad), { mode, profiles: null, failed: true })
  assert.deepEqual(apn.readBackOutcome(bad, ok([{ profileId: '1' }])), { mode: null, profiles: [{ profileId: '1' }], failed: true })
})

// ── SMS collection ────────────────────────────────────────────────────────────

const M = (id, tag) => ({ id, number: `+1000000${id}`, content: `msg ${id}`, tag })
const LIST = [M(1, 1), M(2, 0), M(3, 2), M(4, 3), M(5, 1), M(6, 4)]

test('boxes are derived from the full collection by tag; drafts are in neither', () => {
  assert.deepEqual(sms.inBox(LIST, 'inbox').map((m) => m.id), [1, 2, 5])
  assert.deepEqual(sms.inBox(LIST, 'sent').map((m) => m.id), [3, 4])
})

test('unread count is the inbox unread messages whichever box is shown', () => {
  assert.equal(sms.unreadCount(LIST), 2)
  assert.equal(sms.unreadCount([M(3, 2)]), 0)
})

test('markRead / restoreUnread are inverse, touch only that message and keep identity on no-ops', () => {
  const read = sms.markRead(LIST, 1)
  assert.equal(read.find((m) => m.id === 1).tag, 0)
  assert.equal(read.find((m) => m.id === 5).tag, 1)
  assert.equal(LIST[0].tag, 1, 'input not mutated')
  assert.equal(sms.markRead(read, 1), read, 'already read: same array')
  assert.equal(sms.markRead(LIST, 3), LIST, 'sent message is untouched')
  assert.deepEqual(sms.restoreUnread(read, 1), LIST)
  assert.equal(sms.restoreUnread(read, 99), read)
})

test('removeMessage deletes by id and a missing id is a no-op', () => {
  assert.deepEqual(sms.removeMessage(LIST, 2).map((m) => m.id), [1, 3, 4, 5, 6])
  assert.equal(sms.removeMessage(LIST, 99), LIST)
})

test('a deleted message cannot come back through later helpers', () => {
  const after = sms.removeMessage(LIST, 1)
  assert.equal(sms.findMessage(after, 1), null)
  assert.equal(sms.reconcileSelection(after, 1), null)
  assert.equal(sms.markRead(after, 1), after)
  assert.equal(sms.restoreUnread(after, 1), after)
})

test('selection is by id and reconciles when the message disappears', () => {
  assert.equal(sms.reconcileSelection(LIST, 2), 2)
  assert.equal(sms.reconcileSelection(LIST, null), null)
  assert.equal(sms.reconcileSelection(LIST, 42), null)
  assert.equal(sms.findMessage(LIST, 5).content, 'msg 5')
})
