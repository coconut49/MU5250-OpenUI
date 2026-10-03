// USB mode view logic (PLAN2 R10/R11). Fixtures are synthetic status payloads in the shape of
// agent/src/usb.rs `usb_status`; nothing here talks to a device.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { loadTs } = require('./ts-loader.cjs')
const usb = loadTs('features/system/usbView.ts')

const caps = (over = {}) => {
  const base = {
    rndis: { mode: 'rndis', supported: true, experimental: false },
    ecm: { mode: 'ecm', supported: true, experimental: false },
    ncm: { mode: 'ncm', supported: true, experimental: true },
  }
  return Object.values({ ...base, ...over }).filter(Boolean)
}
const status = (over = {}) => ({
  active_mode: 'ecm',
  default_mode: 'ecm',
  ncm_persist_on_boot: false,
  supported_modes: ['rndis', 'ecm', 'ncm'],
  mode_capabilities: caps(),
  ...over,
})
const byMode = (s) => Object.fromEntries(usb.usbModeAvailability(s).map((a) => [a.mode, a]))

test('availability never contains a debug mode, whatever the agent lists', () => {
  const s = status({ supported_modes: ['rndis', 'ecm', 'ncm', 'debug'] })
  assert.deepEqual(usb.usbModeAvailability(s).map((a) => a.mode), ['rndis', 'ecm', 'ncm'])
  assert.deepEqual([...usb.USB_MODE_KEYS], ['rndis', 'ecm', 'ncm'])
  assert.equal(usb.isUsbModeKey('debug'), false)
})

test('a capability that says unsupported cannot be re-enabled by the supported_modes list', () => {
  const s = status({ mode_capabilities: caps({ ncm: { mode: 'ncm', supported: false, experimental: true } }) })
  const m = byMode(s)
  assert.equal(s.supported_modes.includes('ncm'), true)
  assert.equal(m.ncm.supported, false)
  assert.equal(m.ncm.source, 'capabilities')
  assert.match(m.ncm.reason, /NCM is not available/)
  assert.equal(m.ecm.supported, true)
})

test('with capabilities present, a mode they do not list is not offered', () => {
  const s = status({ mode_capabilities: [{ mode: 'ecm', supported: true, experimental: false }] })
  const m = byMode(s)
  assert.equal(m.rndis.supported, false)
  assert.equal(m.ncm.supported, false)
  assert.equal(m.ecm.supported, true)
})

test('without capabilities the documented supported_modes fallback applies', () => {
  for (const missing of [undefined, []]) {
    const s = status({ mode_capabilities: missing, supported_modes: ['rndis', 'ecm'] })
    const m = byMode(s)
    assert.equal(m.ecm.supported, true)
    assert.equal(m.rndis.supported, true)
    assert.equal(m.ncm.supported, false)
    assert.equal(m.ecm.source, 'supported_modes')
    assert.match(m.ncm.reason, /supported modes/)
  }
  // NCM stays experimental in the fallback even when the agent omits experimental_modes.
  assert.equal(byMode(status({ mode_capabilities: undefined }))['ncm'].experimental, true)
})

test('no status offers nothing and never fabricates support', () => {
  const m = byMode(null)
  for (const a of Object.values(m)) {
    assert.equal(a.supported, false)
    assert.equal(a.source, 'none')
  }
  assert.deepEqual(usb.planUsbSwitch(null, 'ecm'), { ok: false, reason: 'USB status is unavailable.' })
})

test('boot default is separate from the active mode', () => {
  const s = status({ active_mode: 'ecm', default_mode: 'ncm', ncm_persist_on_boot: true })
  assert.equal(usb.usbBootDefault(s), 'ncm')
  assert.equal(s.active_mode, 'ecm')
  assert.equal(usb.usbBootDefault(status({ default_mode: undefined, ncm_persist_on_boot: true })), 'ncm')
  assert.equal(usb.usbBootDefault(status({ default_mode: undefined, ncm_persist_on_boot: false })), 'ecm')
  assert.equal(usb.usbBootDefault(status({ default_mode: undefined, ncm_persist_on_boot: undefined })), null)
  assert.equal(usb.usbBootDefault(null), null)
})

test('plans: NCM carries the experimental flag, ECM and RNDIS do not', () => {
  const ncm = usb.planUsbSwitch(status(), 'ncm')
  assert.equal(ncm.ok, true)
  assert.deepEqual(ncm.options, { confirm_experimental: true })
  assert.equal(ncm.rollbackFromNcm, false)
  assert.equal(ncm.confirm.kind, 'connection')
  assert.match(ncm.confirm.recovery, /Wi-Fi/)
  assert.match(ncm.confirm.consequence, /re-enumerates/)
  const rndis = usb.planUsbSwitch(status(), 'rndis')
  assert.equal(rndis.ok, true)
  assert.equal(rndis.options, undefined)
  assert.equal(rndis.confirm.kind, 'connection')
})

test('plans: NCM to ECM is described as a rollback', () => {
  const p = usb.planUsbSwitch(status({ active_mode: 'ncm' }), 'ecm')
  assert.equal(p.ok, true)
  assert.equal(p.rollbackFromNcm, true)
  assert.equal(p.options, undefined)
  assert.match(p.confirm.title, /Roll back/)
  assert.deepEqual(p.confirm.details[1], { label: 'Active now', value: 'NCM' })
})

test('plans refuse debug, unknown, unsupported and already-active modes', () => {
  assert.equal(usb.planUsbSwitch(status(), 'debug').ok, false)
  assert.equal(usb.planUsbSwitch(status(), '').ok, false)
  assert.equal(usb.planUsbSwitch(status(), null).ok, false)
  assert.equal(usb.planUsbSwitch(status(), { mode: 'ncm' }).ok, false)
  const noNcm = status({ mode_capabilities: caps({ ncm: { mode: 'ncm', supported: false, experimental: true } }) })
  const refused = usb.planUsbSwitch(noNcm, 'ncm')
  assert.equal(refused.ok, false)
  assert.match(refused.reason, /unsupported/)
  assert.match(usb.planUsbSwitch(status(), 'ecm').reason, /already the active mode/)
})

const NCM_RESULT = { state: 'scheduled', mode: 'ncm', experimental: true, delayMs: 1000, rollback: 'reboot or switch back to ECM after reconnecting' }

test('a scheduled result is pending, not applied: old active status stays waiting', () => {
  const pending = usb.pendingFromResult(NCM_RESULT, 'ncm', 'ecm', 1000)
  assert.equal(pending.via, 'scheduled')
  assert.equal(pending.requested, 'ncm')
  assert.equal(pending.rollback, NCM_RESULT.rollback)
  const old = { kind: 'status', status: status({ active_mode: 'ecm' }) }
  assert.deepEqual(usb.evaluateSwitch(pending, old, 4000), { state: 'waiting' })
  assert.deepEqual(usb.evaluateSwitch(pending, null, 1500), { state: 'waiting' })
  assert.equal(usb.scheduledMode(pending, { state: 'waiting' }), 'ncm')
  assert.equal(usb.describeVerdict(pending, { state: 'waiting' }, 'ecm').text.includes('scheduled'), true)
})

test('a matching active mode verifies, even after the deadline, and clears the scheduled mode', () => {
  const pending = usb.pendingFromResult(NCM_RESULT, 'ncm', 'ecm', 0)
  const ncm = { kind: 'status', status: status({ active_mode: 'ncm' }) }
  assert.deepEqual(usb.evaluateSwitch(pending, ncm, 3000), { state: 'verified' })
  assert.deepEqual(usb.evaluateSwitch(pending, ncm, usb.USB_VERIFY_TIMEOUT_MS + 5000), { state: 'verified' })
  assert.equal(usb.scheduledMode(pending, { state: 'verified' }), null)
  assert.equal(usb.isTerminalVerdict({ state: 'verified' }), true)
})

test('an unreachable management path reads as reconnecting, then not verified; never terminal early', () => {
  const pending = usb.pendingFromResult(NCM_RESULT, 'ncm', 'ecm', 0)
  const gone = { kind: 'unreachable', message: 'Failed to reach the agent' }
  const v = usb.evaluateSwitch(pending, gone, 6000)
  assert.deepEqual(v, { state: 'reconnecting' })
  assert.equal(usb.isTerminalVerdict(v), false)
  assert.match(usb.describeVerdict(pending, v, 'ecm').text, /^Reconnect, verifying/)
  const late = usb.evaluateSwitch(pending, gone, usb.USB_VERIFY_TIMEOUT_MS)
  assert.deepEqual(late, { state: 'timeout', unreachable: true, lastActive: null })
  assert.match(usb.describeVerdict(pending, late, 'ecm').text, /^Not verified/)
})

test('timeout with a readable but unchanged status names the active mode and says the request was not repeated', () => {
  const pending = usb.pendingFromResult(NCM_RESULT, 'ncm', 'ecm', 0)
  const old = { kind: 'status', status: status({ active_mode: 'ecm' }) }
  const v = usb.evaluateSwitch(pending, old, usb.USB_VERIFY_TIMEOUT_MS)
  assert.deepEqual(v, { state: 'timeout', unreachable: false, lastActive: 'ecm' })
  const text = usb.describeVerdict(pending, v, 'ecm').text
  assert.match(text, /still reads ECM/)
  assert.match(text, /not repeated/)
  assert.doesNotMatch(text, /reboot/i)
  assert.equal(usb.scheduledMode(pending, v), 'ncm', 'still shown as requested, not applied')
})

test('an explicit agent error stops verification immediately', () => {
  const pending = usb.pendingFromResult(NCM_RESULT, 'ncm', 'ecm', 0)
  const v = usb.evaluateSwitch(pending, { kind: 'error', message: 'ubus failed' }, 1000)
  assert.deepEqual(v, { state: 'error', message: 'ubus failed' })
  assert.equal(usb.isTerminalVerdict(v), true)
})

test('read errors: an HTTP status means the agent answered; none means unreachable', () => {
  const agent = Object.assign(new Error('request failed (503)'), { status: 503 })
  assert.deepEqual(usb.classifyUsbReadError(agent), { kind: 'error', message: 'request failed (503)' })
  assert.equal(usb.classifyUsbReadError(new Error('Failed to reach the agent at http://x')).kind, 'unreachable')
  assert.equal(usb.classifyUsbReadError('boom').kind, 'unreachable')
  assert.equal(usb.classifyUsbReadError(null).kind, 'unreachable')
})

test('an applied (ubus) result and an unknown outcome are pending until status confirms', () => {
  const applied = usb.pendingFromResult({ state: 'applied', raw: {} }, 'rndis', 'ecm', 0)
  assert.equal(applied.via, 'accepted')
  assert.equal(applied.requested, 'rndis')
  assert.doesNotMatch(usb.describeVerdict(applied, { state: 'waiting' }, 'ecm').text, /reboot|complete/i)
  const unknown = usb.pendingFromUnknown('ncm', 'ecm', 0)
  assert.equal(unknown.via, 'unknown')
  assert.match(usb.describeVerdict(unknown, { state: 'waiting' }, 'ecm').text, /not known whether/)
})

test('a scheduled result with an unreadable mode falls back to the frozen submitted mode', () => {
  const p = usb.pendingFromResult({ state: 'scheduled', mode: null, experimental: false, delayMs: null }, 'ecm', 'ncm', 0)
  assert.equal(p.requested, 'ecm')
  assert.equal(p.rollback, undefined)
})

test('active NCM with ECM scheduled keeps the three facts apart', () => {
  const s = status({ active_mode: 'ncm', default_mode: 'ecm' })
  const pending = usb.pendingFromResult({ state: 'scheduled', mode: 'ecm', experimental: false, delayMs: 1000 }, 'ecm', 'ncm', 0)
  assert.equal(s.active_mode, 'ncm')
  assert.equal(usb.scheduledMode(pending, { state: 'waiting' }), 'ecm')
  assert.equal(usb.usbBootDefault(s), 'ecm')
})
