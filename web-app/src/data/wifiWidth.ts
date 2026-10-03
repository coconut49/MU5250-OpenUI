// Wi-Fi channel-width normalisation (PLAN2 R13).
//
// UCI `htmode` carries the PHY mode and width together ('HT40', 'VHT80', 'HE80',
// 'EHT160') while `iw` reports the runtime width as '80 MHz'. To compare them
// both are reduced to a number of MHz; the PHY mode stays in the raw string.
// Anything not recognised (including '80+80' / '160+160' non-contiguous modes,
// 'auto', '20/40') is undefined, so unknown data can never raise a mismatch.

const VALID_WIDTHS = new Set([20, 40, 80, 160, 320])

/** Channel width in MHz, or undefined when it cannot be determined with confidence. */
export function widthMhz(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) && VALID_WIDTHS.has(value) ? value : undefined
  if (typeof value !== 'string') return undefined
  const t = value.trim().toUpperCase()
  if (!t) return undefined
  // 'HT40', 'HT40+', 'HT40-', 'VHT80', 'HE160', 'EHT320'
  let m = /^(?:HT|VHT|HE|EHT)(\d{2,3})[+-]?$/.exec(t)
  // '80 MHz', '80MHz', '80', '20.0 MHz'
  m ??= /^(\d{2,3})(?:\.0+)?\s*(?:MHZ)?$/.exec(t)
  if (!m) return undefined
  const n = Number(m[1])
  return VALID_WIDTHS.has(n) ? n : undefined
}

/** True when both widths are known and equal; false when known and different; undefined if either is unknown. */
export function widthsAgree(a: unknown, b: unknown): boolean | undefined {
  const x = widthMhz(a)
  const y = widthMhz(b)
  return x === undefined || y === undefined ? undefined : x === y
}
