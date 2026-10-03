// Charge-limit commit rule (PLAN2 R15): only a valid, changed draft is sent.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { loadTs } = require('./ts-loader.cjs')
const { validLimit, limitToApply } = loadTs('features/system/chargeLimit.ts')

test('only integer 5 % steps between 50 and 100 are valid limits', () => {
  for (const v of [50, 55, 80, 100]) assert.equal(validLimit(v), v)
  for (const v of [45, 105, 52, 80.5, NaN, Infinity, '80', null, undefined]) assert.equal(validLimit(v), null, String(v))
})

test('a pristine draft or one equal to the device value commits nothing', () => {
  assert.equal(limitToApply(null, 90), null)
  assert.equal(limitToApply(90, 90), null)
})

test('a changed valid draft commits exactly that value', () => {
  assert.equal(limitToApply(80, 90), 80)
  assert.equal(limitToApply(100, null), 100)
})

test('an invalid draft never commits', () => {
  assert.equal(limitToApply(52, 90), null)
})
