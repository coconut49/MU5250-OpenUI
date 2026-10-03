// Data-usage mapping and device date parsing (PLAN2 R04/R05).
// Fixtures: sanitised shape based on HK B04 (`GET /api/dashboard` data_usage); values are synthetic.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { loadTs } = require('./ts-loader.cjs')
const dates = loadTs('data/dates.ts')
const usage = loadTs('data/usage.ts')

const period = (rx, tx, t = 100) => ({ rx_bytes: rx, tx_bytes: tx, time_secs: t, tx_packets: 5, rx_packets: 6 })
const PAYLOAD = {
  day: period(1000, 500, 60), month: period(2e9, 5e8, 3600), cycle: period(2e9, 5e8, 3600),
  since_power_on: period(3e8, 1e8, 56880), total: period(9e10, 1e10, 99999),
  reset_day: 16, reset_enabled: 1, clear_date_record: '2026/09/16', next_clear_date: '20261016',
}

test('well-formed usage keeps every counter and both date formats', () => {
  const u = usage.mapDataUsage(PAYLOAD)
  assert.deepEqual(u.month, { rx_bytes: 2e9, tx_bytes: 5e8, time_secs: 3600 })
  assert.deepEqual(u.since_power_on, { rx_bytes: 3e8, tx_bytes: 1e8, time_secs: 56880 })
  assert.equal(u.reset_day, 16)
  assert.equal(u.reset_enabled, true)
  assert.equal(u.clear_date_record, '2026/09/16')
  assert.equal(u.next_clear_date, '20261016')
  assert.deepEqual(u.cycle_start, { year: 2026, month: 9, day: 16 })
  assert.deepEqual(u.next_reset, { year: 2026, month: 10, day: 16 })
})

test('all-null period stays unknown: no zeros, no total', () => {
  const u = usage.mapDataUsage({ ...PAYLOAD, day: { rx_bytes: null, tx_bytes: null, time_secs: null } })
  assert.deepEqual(u.day, { rx_bytes: null, tx_bytes: null, time_secs: null })
  assert.equal(usage.usageTotal(u.day), null)
})

test('missing or malformed period objects map to all-null periods instead of crashing', () => {
  const u = usage.mapDataUsage({ reset_day: 1, reset_enabled: 0 })
  for (const key of ['day', 'month', 'total']) assert.deepEqual(u[key], { rx_bytes: null, tx_bytes: null, time_secs: null }, key)
  assert.equal(u.cycle, undefined)
  assert.equal(u.since_power_on, undefined)
  const bad = usage.mapDataUsage({ ...PAYLOAD, day: 'oops', month: [], total: null, cycle: 5 })
  assert.deepEqual(bad.day, { rx_bytes: null, tx_bytes: null, time_secs: null })
  assert.deepEqual(bad.month, { rx_bytes: null, tx_bytes: null, time_secs: null })
  assert.deepEqual(bad.total, { rx_bytes: null, tx_bytes: null, time_secs: null })
  assert.equal(bad.cycle, undefined)
})

test('one missing direction keeps the known component and gives an unknown total', () => {
  const u = usage.mapDataUsage({ ...PAYLOAD, day: { rx_bytes: 700, tx_bytes: null, time_secs: 5 } })
  assert.equal(u.day.rx_bytes, 700)
  assert.equal(u.day.tx_bytes, null)
  assert.equal(usage.usageTotal(u.day), null)
  const other = usage.mapDataUsage({ ...PAYLOAD, day: { tx_bytes: 40 } })
  assert.equal(other.day.rx_bytes, null)
  assert.equal(other.day.tx_bytes, 40)
  assert.equal(usage.usageTotal(other.day), null)
})

test('measured zero in both directions is a real zero total, not unknown', () => {
  const u = usage.mapDataUsage({ ...PAYLOAD, day: { rx_bytes: 0, tx_bytes: 0, time_secs: 0 } })
  assert.deepEqual(u.day, { rx_bytes: 0, tx_bytes: 0, time_secs: 0 })
  assert.equal(usage.usageTotal(u.day), 0)
})

test('numeric strings are accepted; malformed, negative and non-finite values become unknown', () => {
  const u = usage.mapDataUsage({
    ...PAYLOAD,
    day: { rx_bytes: '1234', tx_bytes: '0', time_secs: '60' },
    month: { rx_bytes: '12abc', tx_bytes: -5, time_secs: '' },
    total: { rx_bytes: Infinity, tx_bytes: NaN, time_secs: '-1' },
  })
  assert.deepEqual(u.day, { rx_bytes: 1234, tx_bytes: 0, time_secs: 60 })
  assert.deepEqual(u.month, { rx_bytes: null, tx_bytes: null, time_secs: null })
  assert.deepEqual(u.total, { rx_bytes: null, tx_bytes: null, time_secs: null })
  assert.equal(usage.usageTotal(u.day), 1234)
})

test('usageTotal handles missing input', () => {
  assert.equal(usage.usageTotal(undefined), null)
  assert.equal(usage.usageTotal(null), null)
  assert.equal(usage.usageTotal({ rx_bytes: 1, tx_bytes: 2, time_secs: null }), 3)
})

test('reset_enabled: 1/0, numeric strings and booleans are known; null/missing/garbage are unknown', () => {
  const enabled = (v) => usage.mapDataUsage({ ...PAYLOAD, reset_enabled: v }).reset_enabled
  assert.equal(enabled(1), true)
  assert.equal(enabled('1'), true)
  assert.equal(enabled(true), true)
  assert.equal(enabled(0), false)
  assert.equal(enabled('0'), false)
  assert.equal(enabled(false), false)
  for (const unknown of [null, undefined, '', 'maybe', 2, {}]) assert.equal(enabled(unknown), null, String(unknown))
  assert.equal(usage.mapDataUsage({}).reset_enabled, null)
})

test('reset_day is 1-31 or null (unknown), never defaulted to 1', () => {
  const day = (v) => usage.mapDataUsage({ ...PAYLOAD, reset_day: v }).reset_day
  assert.equal(day(1), 1)
  assert.equal(day(31), 31)
  assert.equal(day('15'), 15)
  for (const bad of [0, 32, -1, 1.5, null, undefined, '', 'x']) assert.equal(day(bad), null, String(bad))
  assert.equal(usage.mapDataUsage({}).reset_day, null)
})

test('unknown reset configuration with valid counters (ubus and UCI both failed)', () => {
  const u = usage.mapDataUsage({ ...PAYLOAD, reset_day: null, reset_enabled: null, clear_date_record: null, next_clear_date: null })
  assert.equal(u.reset_day, null)
  assert.equal(u.reset_enabled, null)
  assert.equal(u.cycle_start, null)
  assert.equal(u.next_reset, null)
  assert.equal(u.day.rx_bytes, 1000)
})

test('missing or malformed date strings parse to null and keep the raw value when it is a string', () => {
  const u = usage.mapDataUsage({ ...PAYLOAD, clear_date_record: 'garbage', next_clear_date: '20260231' })
  assert.equal(u.clear_date_record, 'garbage')
  assert.equal(u.cycle_start, null)
  assert.equal(u.next_reset, null)
  assert.equal(usage.mapDataUsage({ ...PAYLOAD, clear_date_record: undefined }).clear_date_record, undefined)
})

// ── dates ──────────────────────────────────────────────────────────────────────

test('parseDeviceDate understands YYYY/MM/DD, YYYYMMDD and YYYY-MM-DD', () => {
  assert.deepEqual(dates.parseDeviceDate('2026/09/16'), { year: 2026, month: 9, day: 16 })
  assert.deepEqual(dates.parseDeviceDate('20261016'), { year: 2026, month: 10, day: 16 })
  assert.deepEqual(dates.parseDeviceDate('2026-10-16'), { year: 2026, month: 10, day: 16 })
  assert.deepEqual(dates.parseDeviceDate(' 2026/9/6 '), { year: 2026, month: 9, day: 6 })
  assert.deepEqual(dates.parseDeviceDate(20261016), { year: 2026, month: 10, day: 16 })
})

test('parseDeviceDate rejects impossible and malformed dates', () => {
  for (const bad of [
    '20260231', '2026/02/30', '2026-13-01', '2026/00/10', '2026/10/00', '2026/10/32', '20261301', '2025/02/29', '1900/02/29',
    '', ' ', '2026', '26/10/16', '16/10/2026', '2026.10.16', 'abc', '2026/10', '20261016123', null, undefined, {}, [], NaN, 2026.5, '0000/01/01',
  ]) {
    assert.equal(dates.parseDeviceDate(bad), null, String(bad))
  }
})

test('leap days are valid only in leap years', () => {
  assert.deepEqual(dates.parseDeviceDate('2028/02/29'), { year: 2028, month: 2, day: 29 })
  assert.deepEqual(dates.parseDeviceDate('20000229'), { year: 2000, month: 2, day: 29 })
  assert.equal(dates.parseDeviceDate('2027/02/29'), null)
  assert.equal(dates.parseDeviceDate('21000229'), null)
  assert.equal(dates.isLeapYear(2100), false)
  assert.equal(dates.isLeapYear(2400), true)
  assert.equal(dates.daysInMonth(2028, 2), 29)
  assert.equal(dates.daysInMonth(2026, 4), 30)
  assert.equal(dates.daysInMonth(2026, 12), 31)
})

test('formatCalendarDate is locale- and timezone-independent', () => {
  assert.equal(dates.formatCalendarDate({ year: 2026, month: 10, day: 16 }), '16 Oct 2026')
  assert.equal(dates.formatCalendarDate({ year: 2026, month: 1, day: 1 }), '1 Jan 2026')
  assert.equal(dates.formatCalendarDate({ year: 2028, month: 2, day: 29 }), '29 Feb 2028')
  assert.equal(dates.formatCalendarDate(null), '—')
  assert.equal(dates.formatCalendarDate(undefined), '—')
  assert.equal(dates.formatCalendarDate({ year: 2026, month: 2, day: 31 }), '—')
})

test('date parsing and formatting are unaffected by the process timezone', () => {
  const saved = process.env.TZ
  try {
    for (const tz of ['Pacific/Auckland', 'America/Los_Angeles', 'UTC']) {
      process.env.TZ = tz
      const d = dates.parseDeviceDate('20261001')
      assert.equal(dates.formatCalendarDate(d), '1 Oct 2026', tz)
      assert.equal(dates.toIsoDate(d), '2026-10-01', tz)
    }
  } finally {
    if (saved === undefined) delete process.env.TZ
    else process.env.TZ = saved
  }
})

test('compareCalendarDates orders across year rollover', () => {
  const dec = { year: 2026, month: 12, day: 31 }
  const jan = { year: 2027, month: 1, day: 1 }
  assert.ok(dates.compareCalendarDates(dec, jan) < 0)
  assert.ok(dates.compareCalendarDates(jan, dec) > 0)
  assert.equal(dates.compareCalendarDates(jan, { ...jan }), 0)
})
