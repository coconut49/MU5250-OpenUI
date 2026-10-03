// Calendar-date helpers for device date strings (billing cycle dates).
//
// The firmware reports date-only strings in more than one format:
//   clear_date_record  '2026/09/16'   (YYYY/MM/DD)
//   next_clear_date    '20261016'     (YYYYMMDD)
// and YYYY-MM-DD is accepted too. They are calendar dates in the router's
// (local) time, NOT instants: never route them through `Date`, which would
// reinterpret them as UTC and shift the day in other browser timezones.

import type { CalendarDate } from '../types'

export type { CalendarDate }

const MIN_YEAR = 1970
const MAX_YEAR = 2199

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

export function isValidCalendarDate(year: number, month: number, day: number): boolean {
  return (
    Number.isInteger(year) && Number.isInteger(month) && Number.isInteger(day) &&
    year >= MIN_YEAR && year <= MAX_YEAR &&
    month >= 1 && month <= 12 &&
    day >= 1 && day <= daysInMonth(year, month)
  )
}

/**
 * Parse a device date-only value. Returns null for anything that is not a real
 * calendar date in one of the known formats (missing, empty, wrong shape,
 * 20260231, 2025/02/29, ...). Never throws.
 */
export function parseDeviceDate(value: unknown): CalendarDate | null {
  let text: string
  if (typeof value === 'string') text = value.trim()
  else if (typeof value === 'number' && Number.isInteger(value)) text = String(value)
  else return null
  const m =
    /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(text) ??
    /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text) ??
    /^(\d{4})(\d{2})(\d{2})$/.exec(text)
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  return isValidCalendarDate(year, month, day) ? { year, month, day } : null
}

/** "16 Oct 2026". Locale-independent so every viewer sees the same date. */
export function formatCalendarDate(date: CalendarDate | null | undefined): string {
  if (!date || !isValidCalendarDate(date.year, date.month, date.day)) return '—'
  return `${date.day} ${MONTHS[date.month - 1]} ${date.year}`
}

/** Negative / zero / positive like a comparator. */
export function compareCalendarDates(a: CalendarDate, b: CalendarDate): number {
  return a.year - b.year || a.month - b.month || a.day - b.day
}

/** YYYY-MM-DD. */
export function toIsoDate(date: CalendarDate): string {
  const p = (n: number, w: number) => String(n).padStart(w, '0')
  return `${p(date.year, 4)}-${p(date.month, 2)}-${p(date.day, 2)}`
}
