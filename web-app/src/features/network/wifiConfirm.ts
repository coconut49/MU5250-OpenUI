// Confirmation copy for Wi-Fi changes that drop clients (PLAN2 R11). Pure: callers freeze the
// payload first, pass it here, and submit exactly that payload once if the dialog resolves true.
// Never contains a password; the browser's own connection is not guessed, only named as a possibility.

import type { WifiBand } from '../../types'
import type { ConfirmOptions } from '../../ui/feedback'
import { describePatch, type WifiPatch } from './wifiDraft'

const WAN_NOTE = 'Mobile data to the Internet is not changed.'

export function masterOffConfirm(): ConfirmOptions {
  return {
    title: 'Turn off all Wi-Fi?',
    kind: 'connection',
    confirmLabel: 'Turn off Wi-Fi',
    details: [
      { label: 'Operation', value: 'Turn Wi-Fi off' },
      { label: 'Radios', value: '2.4 GHz and 5 GHz' },
    ],
    consequence: `Every device connected over Wi-Fi, possibly this browser, will disconnect and this dashboard cannot be reached over Wi-Fi. ${WAN_NOTE}`,
    recovery: 'Connect with USB-C or a cable, open this dashboard and turn Wi-Fi back on.',
  }
}

export function radioOffConfirm(band: string, other: string): ConfirmOptions {
  return {
    title: `Turn off ${band} Wi-Fi?`,
    kind: 'connection',
    confirmLabel: `Turn off ${band}`,
    details: [
      { label: 'Operation', value: 'Disable radio' },
      { label: 'Band', value: band },
    ],
    consequence: `Devices connected on ${band}, possibly this browser, will disconnect. ${WAN_NOTE}`,
    recovery: `Reconnect to the ${other} network or use USB-C, open this dashboard and turn ${band} back on.`,
  }
}

export function bandSaveConfirm(band: string, other: string, patch: WifiPatch, observed: WifiBand): ConfirmOptions {
  const renamed = Object.keys(patch).some((k) => k.startsWith('ssid_'))
  return {
    title: `Apply ${band} Wi-Fi changes?`,
    kind: 'connection',
    confirmLabel: 'Apply changes',
    details: [{ label: 'Band', value: band }, ...describePatch(patch, observed)],
    consequence: `Wi-Fi restarts to apply this. Devices connected on ${band}, possibly this browser, will disconnect${renamed ? ' and must rejoin under the new name' : ''}. ${WAN_NOTE}`,
    recovery: `Reconnect to the ${renamed ? 'new ' : ''}${band} network, or to ${other} or USB-C, then reopen this dashboard. If a setting is wrong, change it back here.`,
  }
}

export function syncConfirm(
  source: string,
  target: string,
  patch: WifiPatch,
  targetObserved: WifiBand,
  includePassword: boolean,
): ConfirmOptions {
  return {
    title: `Copy ${source} settings to ${target}?`,
    kind: 'connection',
    confirmLabel: 'Copy settings',
    details: [
      { label: 'Operation', value: `Copy ${source} to ${target}` },
      ...describePatch(patch, targetObserved).filter((d) => d.label !== 'Password'),
      { label: 'Password', value: includePassword ? 'Copied (not shown)' : 'Not copied' },
    ],
    consequence: `Wi-Fi restarts. Devices connected on ${target}, possibly this browser, will disconnect and may need to rejoin. ${WAN_NOTE}`,
    recovery: `Reconnect to ${source} or USB-C, then reopen this dashboard.`,
  }
}
