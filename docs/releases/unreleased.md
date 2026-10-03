Unreleased changes to the dashboard and its mock/test tooling, plus one agent
response change. Package versions are unchanged (2.4.0); this file is renamed
and given a version heading when the release is cut.

Local checks only. These changes have not been deployed to or verified on a
physical modem; live-device validation is pending.

### Signal ratings changed (not the radio)

RSRP, RSRQ and SINR now follow one policy (`web-app/src/data/signalQuality.ts`)
used by Home, Signal, the tables and the legend. Lower bounds are inclusive.

| Metric | Excellent | Good | Fair | Poor |
|---|---|---|---|---|
| RSRP, dBm | >= -80 | -90 to -80 | -100 to -90 | < -100 |
| RSRQ, dB | >= -10 | -15 to -10 | -20 to -15 | < -20 |
| SINR, dB | >= 20 | 10 to 20 | 0 to 10 | < 0 |

A reading that was orange before can be green now. For example, RSRQ -11 dB was
rated fair and is now good. The policy changed; the radio did not. RSSI is
shown but not rated. A missing measurement shows "Unavailable".

### Displayed values

- Home and Signal use the validated primary carrier: SA shows the NR PCC, LTE
  and NSA show the LTE anchor PCC. Unknown bars and measurements show
  Unavailable instead of a guess.
- Data usage counters can be unknown and are no longer shown as 0. The cycle
  block is "Current cycle". Reset day, enablement and the next reset date come
  from the device (both firmware date formats are read). `since_power_on` is
  shown as "Connection counters" because the firmware's `real_*` values reset
  with the data connection. Saving a reset day also enables automatic reset,
  and the button says so.
- Band locks distinguish unknown, automatic and locked. NR SA and NSA locks are
  read separately. A lock covering every supported band shows "All bands".
  Known limitation: the modem's default LTE mask covers 22 bands while the agent
  lists 24 lockable LTE bands (B66 and B71 are extra), so the device's default
  LTE state shows 22 bands selected, not "All bands".
- Wi-Fi TX power shows the real percentage (1-100). Channel widths are compared
  numerically, and channel advice is limited to configuration facts.
- USB: the Debug (ADB) option is removed. Capabilities decide which modes are
  offered. Active, scheduled and boot-default modes are shown separately.
  Verification is bounded and never resends the request.

### Safer editing

- Drafts survive polling: band selections, per-band Wi-Fi fields, the charge
  limit (now Apply / Cancel), TTL, network mode and APN mode.
- Connection-dropping actions are confirmed before they are sent: Wi-Fi off,
  per-band changes, save and sync; APN mode and activation; network mode; band
  lock and reset; cell lock and reset; USB mode; LAN. The reviewed payload is
  frozen. The UI reports accepted and verified separately, and never retries
  automatically. Cell-lock behaviour is unchanged apart from the confirmation
  and layout.
- SMS keeps one message collection; Inbox and Sent are views of it. Alerts have
  stable ids, dismissal lasts for the episode, and only a new episode or an
  escalation is announced.

### Resource model

`usePoll` and the new one-shot `useResource` report `loading`, `ready`, `error`
or `stale`, never show a previous key's data after a key change, and have their
cache cleared on logout and auth expiry. `/api/dashboard` remains the only
heartbeat (3 s on Home and Signal, 15 s elsewhere).

### Accessibility

Native dialog confirmations with Cancel focused first for danger and connection
actions; tabs with roving focus and manual activation; radiogroups and
`aria-pressed` chips; labelled fields; live-region toasts where errors persist
until dismissed; a focus ring of at least 3:1; 44 px touch targets on coarse
pointers; stacked rows on phones.

### Agent

`data_usage.reset_day` and `reset_enabled` are `null` when neither ubus nor UCI
supplies a valid value. They were previously reported as `1` and `0`, which the
device never said. Clients that read these fields must handle `null`
([AGENT.md](../AGENT.md)).

### Tooling

- Playwright browser harness (`npm run test:browser`, `PW_PORT`, Chromium only,
  `@playwright/test` 1.63.0) now runs in CI. It cannot reach a real agent.
- `scripts/check-api-contract.py` compares method and path; the checker has its
  own tests (`tests/test_api_contract.py`).
- The mock agent (`web-app/tools/mock_agent.py`) is stateful and has
  `/__mock/requests`, `/__mock/reset` and `MOCK_SCENARIO`
  (`tests/test_mock_agent.py`).

Not included: NR cell-lock verification and primary-cell selection were
excluded by the owner.
