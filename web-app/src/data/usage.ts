// Data-usage mapping (PLAN2 R04/R05).
//
// The agent emits JSON null for counters it could not read, numbers, or numeric
// strings. Null/missing/malformed counters stay null (unknown) and are never
// converted to zero; a measured 0 stays 0.

import type { DataUsage, UsagePeriod } from '../types'
import { parseDeviceDate } from './dates'
import { boolLike, intInRange, isObj, nonNegative, str } from './validate'

export const UNKNOWN_PERIOD: UsagePeriod = { rx_bytes: null, tx_bytes: null, time_secs: null }

/** Map one period object. Missing / non-object input gives an all-null period. */
export function mapUsagePeriod(v: unknown): UsagePeriod {
  if (!isObj(v)) return { ...UNKNOWN_PERIOD }
  return {
    rx_bytes: nonNegative(v.rx_bytes) ?? null,
    tx_bytes: nonNegative(v.tx_bytes) ?? null,
    time_secs: nonNegative(v.time_secs) ?? null,
  }
}

/** RX + TX, or null unless both directions are known. Never substitutes one direction for the total. */
export function usageTotal(p: UsagePeriod | null | undefined): number | null {
  if (!p || p.rx_bytes === null || p.tx_bytes === null) return null
  return p.rx_bytes + p.tx_bytes
}

export function mapDataUsage(d: Record<string, unknown>): DataUsage {
  const optionalPeriod = (v: unknown): UsagePeriod | undefined => (isObj(v) ? mapUsagePeriod(v) : undefined)
  const clearRecord = str(d.clear_date_record)
  const nextClear = str(d.next_clear_date)
  return {
    day: mapUsagePeriod(d.day),
    month: mapUsagePeriod(d.month),
    cycle: optionalPeriod(d.cycle),
    since_power_on: optionalPeriod(d.since_power_on),
    total: mapUsagePeriod(d.total),
    // null = unknown: the agent emits null when neither ubus nor UCI could be read.
    reset_day: intInRange(d.reset_day, 1, 31) ?? null,
    reset_enabled: boolLike(d.reset_enabled) ?? null,
    clear_date_record: clearRecord,
    next_clear_date: nextClear,
    cycle_start: parseDeviceDate(d.clear_date_record),
    next_reset: parseDeviceDate(d.next_clear_date),
  }
}
