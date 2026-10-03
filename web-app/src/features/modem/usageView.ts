// Presentation logic for the Data tab's billing-cycle block (PLAN2 R05, U03).
//
// Pure functions: no React, no Date. Everything shown comes from the device's own
// observations (`reset_enabled`, `reset_day`, `cycle_start`, `next_reset`); nothing is
// estimated from the browser clock.

import { isValidCalendarDate, formatCalendarDate } from '../../data/dates'
import type { CalendarDate, DataUsage } from '../../types'

export type ResetState = 'enabled' | 'disabled' | 'unknown'

/** `null` enablement is unknown, never "disabled". */
export function resetState(u: Pick<DataUsage, 'reset_enabled'> | null | undefined): ResetState {
  if (!u) return 'unknown'
  return u.reset_enabled === true ? 'enabled' : u.reset_enabled === false ? 'disabled' : 'unknown'
}

const dateText = (d: CalendarDate | null | undefined): string | null =>
  d && isValidCalendarDate(d.year, d.month, d.day) ? formatCalendarDate(d) : null

export interface CycleView {
  state: ResetState
  /** "Enabled" / "Disabled" / "Unknown". */
  stateLabel: string
  /** Headline when automatic reset is not known to be on; null when enabled. */
  headline: string | null
  /** Reset day as text, or null when the device did not report a valid one. */
  resetDay: string | null
  /** Device-supplied cycle start, or null when missing/invalid. */
  cycleStart: string | null
  /** Whether a "Next reset" row may be shown at all (only when reset is known to be enabled). */
  showNextReset: boolean
  /** Device-supplied next reset date; null when missing/invalid (shown as unavailable). */
  nextReset: string | null
  /** Explanatory line under the counters. */
  note: string
}

export function cycleView(u: DataUsage): CycleView {
  const state = resetState(u)
  return {
    state,
    stateLabel: state === 'enabled' ? 'Enabled' : state === 'disabled' ? 'Disabled' : 'Unknown',
    headline:
      state === 'disabled'
        ? 'Automatic reset disabled'
        : state === 'unknown'
          ? 'Automatic reset status unknown'
          : null,
    resetDay: u.reset_day != null ? String(u.reset_day) : null,
    cycleStart: dateText(u.cycle_start),
    showNextReset: state === 'enabled',
    nextReset: state === 'enabled' ? dateText(u.next_reset) : null,
    note:
      state === 'enabled'
        ? 'Counters are maintained by the router and reset automatically on the reset day.'
        : state === 'disabled'
          ? 'Automatic reset is disabled, so no reset is scheduled.'
          : 'The router did not report whether counters reset automatically.',
  }
}

export type ResetDayParse = { ok: true; day: number } | { ok: false; error: string }

/** Whole number 1–31 only: no blanks, fractions, signs or exponents. */
export function parseResetDay(text: string): ResetDayParse {
  const t = text.trim()
  if (!/^\d{1,2}$/.test(t)) return { ok: false, error: 'Enter a whole number from 1 to 31.' }
  const day = Number(t)
  if (day < 1 || day > 31) return { ok: false, error: 'Enter a whole number from 1 to 31.' }
  return { ok: true, day }
}

export interface ResetDayCopy {
  /** True when saving also switches automatic reset on. */
  turnsOn: boolean
  hint: string
  button: string
}

/** Saving a reset day also enables automatic reset on the agent; say so before it happens. */
export function resetDayCopy(state: ResetState): ResetDayCopy {
  if (state === 'enabled') {
    return { turnsOn: false, hint: 'Day of the month, 1 to 31.', button: 'Save' }
  }
  return {
    turnsOn: true,
    hint:
      state === 'disabled'
        ? 'Day of the month, 1 to 31. Saving also turns automatic reset on.'
        : 'Day of the month, 1 to 31. Automatic reset status is unknown; saving also turns automatic reset on.',
    button: 'Save and turn on automatic reset',
  }
}
