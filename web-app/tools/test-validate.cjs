const { test } = require('node:test')
const assert = require('node:assert/strict')
const { loadTs } = require('./ts-loader.cjs')
const v = loadTs('data/validate.ts')
const { widthMhz, widthsAgree } = loadTs('data/wifiWidth.ts')

test('finiteNumber accepts numbers and strictly numeric strings only', () => {
  assert.equal(v.finiteNumber(0), 0)
  assert.equal(v.finiteNumber(-53), -53)
  assert.equal(v.finiteNumber('31.0'), 31)
  assert.equal(v.finiteNumber(' -0.7 '), -0.7)
  assert.equal(v.finiteNumber('1e3'), 1000)
  assert.equal(v.finiteNumber('0'), 0)
  for (const bad of [null, undefined, '', '  ', '--', 'N/A', '12abc', 'abc', NaN, Infinity, -Infinity, '0x10', {}, [], [5], true, false]) {
    assert.equal(v.finiteNumber(bad), undefined, String(bad))
  }
})

test('nonNegative keeps zero and rejects negatives, null and non-finite', () => {
  assert.equal(v.nonNegative(0), 0)
  assert.equal(v.nonNegative('0'), 0)
  assert.equal(v.nonNegative('42'), 42)
  assert.equal(v.nonNegative(-1), undefined)
  assert.equal(v.nonNegative('-1'), undefined)
  assert.equal(v.nonNegative(null), undefined)
  assert.equal(v.nonNegative(Infinity), undefined)
})

test('intInRange is inclusive and rejects decimals and blanks', () => {
  assert.equal(v.intInRange(1, 1, 100), 1)
  assert.equal(v.intInRange('100', 1, 100), 100)
  assert.equal(v.intInRange(0, 1, 100), undefined)
  assert.equal(v.intInRange(101, 1, 100), undefined)
  assert.equal(v.intInRange(80.5, 1, 100), undefined)
  assert.equal(v.intInRange('', 1, 100), undefined)
  assert.equal(v.intInRange(null, 0, 5), undefined)
  assert.equal(v.intInRange('0', 0, 5), 0)
})

test('nonNegativeInt rejects unsafe and fractional values', () => {
  assert.equal(v.nonNegativeInt(0), 0)
  assert.equal(v.nonNegativeInt('12'), 12)
  assert.equal(v.nonNegativeInt(1.5), undefined)
  assert.equal(v.nonNegativeInt(2 ** 60), undefined)
})

test('boolLike is tri-state: true, false, or undefined', () => {
  for (const t of [true, 1, '1', 'true', 'TRUE', 'on', 'yes', 'enabled', ' 1 ']) assert.equal(v.boolLike(t), true, String(t))
  for (const f of [false, 0, '0', 'false', 'off', 'no', 'disabled']) assert.equal(v.boolLike(f), false, String(f))
  for (const u of [null, undefined, '', 2, -1, 'maybe', {}, []]) assert.equal(v.boolLike(u), undefined, String(u))
})

test('str, nonEmptyStr, obj, arr, strList keep empty and absent distinct', () => {
  assert.equal(v.str(''), '')
  assert.equal(v.str(null), undefined)
  assert.equal(v.str(5), undefined)
  assert.equal(v.nonEmptyStr(''), undefined)
  assert.equal(v.nonEmptyStr('  '), undefined)
  assert.equal(v.nonEmptyStr('a'), 'a')
  assert.deepEqual(v.obj({ a: 1 }), { a: 1 })
  assert.equal(v.obj([]), undefined)
  assert.equal(v.obj(null), undefined)
  assert.deepEqual(v.arr([]), [])
  assert.equal(v.arr({}), undefined)
  assert.deepEqual(v.strList(['a', 1, null, 'b']), ['a', 'b'])
  assert.deepEqual(v.strList([]), [])
  assert.equal(v.strList('a'), undefined)
})

test('widthMhz normalises PHY-mode and unit forms to MHz', () => {
  const cases = {
    HE80: 80, EHT160: 160, EHT320: 320, VHT40: 40, HT20: 20, HT40: 40, 'HT40+': 40, 'HT40-': 40,
    '80 MHz': 80, '80MHz': 80, '80': 80, '160 mhz': 160, ' 20 MHz ': 20, EHT40: 40, EHT80: 80,
  }
  for (const [input, mhz] of Object.entries(cases)) assert.equal(widthMhz(input), mhz, input)
  assert.equal(widthMhz(80), 80)
})

test('widthMhz is conservative: unknown or ambiguous input is undefined', () => {
  for (const bad of ['', 'auto', 'garbage', '80+80', '160+160', 'HE', 'HE85', '25 MHz', '20/40', 'NOHT', null, undefined, NaN, 85, {}, 'MHz']) {
    assert.equal(widthMhz(bad), undefined, String(bad))
  }
})

test('widthsAgree: HE80 equals 80 MHz, EHT160 equals 160 MHz, HE80 differs from 40 MHz', () => {
  assert.equal(widthsAgree('HE80', '80 MHz'), true)
  assert.equal(widthsAgree('EHT160', '160 MHz'), true)
  assert.equal(widthsAgree('HE80', '40 MHz'), false)
  assert.equal(widthsAgree('HE80', undefined), undefined)
  assert.equal(widthsAgree('HE80', 'garbage'), undefined)
})
