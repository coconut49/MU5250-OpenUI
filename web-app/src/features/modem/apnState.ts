// APN state helpers (PLAN2 R08/R11): mode draft/commit decisions, confirmation copy and
// read-back reconciliation. Pure; the owner component performs the requests.

import type { ApnModeState, ApnProfile } from '../../types'
import type { ConfirmOptions } from '../../ui/feedback'

export type ApnMode = 'auto' | 'manual'
export type ObservedApnMode = ApnMode | 'unknown'

export const MODE_LABEL: Record<ObservedApnMode, string> = { auto: 'Automatic', manual: 'Manual', unknown: 'Unknown' }

/** Wire value of `apn_mode`: 0 = automatic, 1 = manual. */
export const modeWire = (m: ApnMode): 0 | 1 => (m === 'auto' ? 0 : 1)

export const modeState = (m: ApnMode): ApnModeState => ({ mode: m, raw: modeWire(m) })

/** What the radio group shows: the draft, else the observed mode. */
export function shownMode(draft: ApnMode | null, observed: ObservedApnMode): ObservedApnMode {
  return draft ?? observed
}

/** Apply is only meaningful for a draft that differs from the observed mode (any draft when unknown). */
export function canApplyMode(draft: ApnMode | null, observed: ObservedApnMode): boolean {
  return draft !== null && draft !== observed
}

const RECONNECT =
  'Mobile data reconnects with the new APN setting, so Internet access through the router may drop briefly. The local network is not restarted, so this dashboard should stay reachable.'

export function modeChangeConfirm(target: ApnMode, observed: ObservedApnMode): ConfirmOptions {
  return {
    title: `Switch APN mode to ${MODE_LABEL[target].toLowerCase()}?`,
    kind: 'connection',
    confirmLabel: `Switch to ${MODE_LABEL[target].toLowerCase()}`,
    details: [{ label: 'APN mode', value: observed === 'unknown' ? MODE_LABEL[target] : `${MODE_LABEL[observed]} → ${MODE_LABEL[target]}` }],
    consequence: RECONNECT,
    recovery:
      target === 'manual'
        ? 'If mobile data does not return, switch back to Automatic or activate a different profile.'
        : 'If mobile data does not return, switch back to Manual and activate a working profile.',
  }
}

/** Never includes the profile password (or username). */
export function activationConfirm(profile: Pick<ApnProfile, 'profilename' | 'wanapn'>, observed: ObservedApnMode): ConfirmOptions {
  return {
    title: `Activate APN profile "${profile.profilename}"?`,
    kind: 'connection',
    confirmLabel: 'Activate',
    details: [
      { label: 'Profile', value: profile.profilename },
      { label: 'APN', value: profile.wanapn },
      { label: 'APN mode', value: observed === 'manual' ? 'Manual' : observed === 'auto' ? 'Automatic → Manual' : 'Manual' },
    ],
    consequence:
      observed === 'manual'
        ? RECONNECT
        : `Activating a profile switches APN mode to manual. ${RECONNECT}`,
    recovery: 'If mobile data does not return, activate another profile or switch back to Automatic.',
  }
}

export interface ReadBack {
  mode: ApnModeState | null
  profiles: ApnProfile[] | null
  /** True when either read failed: the accepted change is not verified. */
  failed: boolean
}

/** Combine the two read-back results; each source is kept independently. */
export function readBackOutcome(
  mode: PromiseSettledResult<ApnModeState>,
  profiles: PromiseSettledResult<ApnProfile[]>,
): ReadBack {
  return {
    mode: mode.status === 'fulfilled' ? mode.value : null,
    profiles: profiles.status === 'fulfilled' ? profiles.value : null,
    failed: mode.status === 'rejected' || profiles.status === 'rejected',
  }
}
