# PLAN2 — Dashboard accuracy, interaction and accessibility remediation

Prepared: 2026-10-02 (Australia/Sydney). Review baseline: commit `c1d9405`.

## Purpose and execution status

This is the implementation handoff for the read-only review of the Rust agent,
dashboard structure, Cobalt/Hallmark UI practices, signal colours, and 5G SA
cell selection. It covers the reported findings and closely related failure
cases confirmed while preparing this plan.

**Writing this document does not implement the fixes or authorise deployment,
device settings changes, or disruptive hardware testing.** All implementation
and regression work below is future work. No item is complete merely because
it appears in this plan. An implementing agent must recheck the named symbols
against the current tree; line numbers from the review are not stable APIs.

The architecture is fundamentally appropriate. Retain the small synchronous
Rust agent, shared bounded subprocess runner, React feature groups, lazy
loading, and shared dashboard heartbeat. Resolve the specific data and state
ownership problems without a framework rewrite, an async Rust runtime, or a
new global state library.

## Non-negotiable implementation boundaries

1. Read [AGENTS.md](AGENTS.md), [docs/SAFETY.md](docs/SAFETY.md),
   [ARCHITECTURE.md](ARCHITECTURE.md), and [web-app/design.md](web-app/design.md)
   before implementing. Cobalt is the local design authority. Change shared
   design rules in `design.md` before applying them; do not override the system
   independently on individual pages.
2. Keep all automated mutation tests on a local synthetic agent or intercepted
   browser requests. Never point them at `192.168.0.1`, a discovered gateway,
   SSH, ADB, real ubus, or real charger/USB/radio controls. A successful mock test
   is not evidence of successful hardware behaviour.
3. Device mutations and deployment require authorisation covering those actions.
   A request to implement frontend fixes does not by itself authorise changing
   the owner's radio, Wi-Fi, APN, charging, USB, or boot configuration. Do not ask
   again if the owner has already explicitly authorised the relevant action.
4. No new boot hooks, init.d/procd/firewall-include changes, system-service UCI
   changes, partition/fuse writes, live `usb_op` writes, daemon-barrier changes,
   or execution of `scripts/research/`. Do not add a radio-mode toggle or reboot
   as an automatic fallback for failed cell selection.
5. Preserve stock behaviour and existing safety controls. In particular, preserve
   charger inversion, power-off-charging USB guards, LAN confirmation/rollback,
   the AT allowlist, authentication, LAN-only API binding, destructive request
   confirmation, atomic state writes, and bounded subprocess execution.
6. Keep device commands, deployment, `usb.rs`, `charge_policy.rs`, auth, AT,
   kill-bloat, boot/safety logic, and final integration review on the main agent.
   Delegate only bounded frontend, test, documentation, or permitted read-only
   firmware research tasks. Changing UI labels around these domains must not
   silently expand into backend changes.
7. Use synthetic identifiers and credentials in fixtures. Never copy IMEI, IMSI,
   ICCID, MSISDN, serials, passwords, tokens, APN credentials, SMS contents, or
   private captures into tests, screenshots, commits, or reports. Do not read
   credentials out of the device startup script. Do not quote the gitignored
   secret-bearing files identified in `AGENTS.md`.
8. Preserve one `/api/dashboard` heartbeat: 3 seconds on Home/Signal and 15
   seconds elsewhere. Home, Signal and Data must continue to share it. Extend
   the existing revision-aware request ownership rather than adding duplicate
   per-page radio/data polls. Agent poll-driven reads stay behind the existing
   `Observed`/`Cached` machinery and appropriate TTLs.
9. The device clock contains local time labelled UTC. Do not calculate freshness
   by subtracting device `sampled_at_ms` from the browser's wall clock. Prefer
   the agent's `age_ms`/`stale` metadata and client monotonic elapsed time.
10. Preserve the JSON envelope and three-way API contract. Any endpoint contract
    change must update `agent/src/server.rs`, `web-app/src/data/api.ts`,
    `web-app/tools/mock_agent.py`, and `docs/AGENT.md` as applicable. A response
    change also requires its types, fixtures, consumers and contract tests.

## Finding-to-task register

Priorities describe implementation order, not a claim that a device has been
damaged. P1 means fix first because an interaction can lose user intent or
disconnect management unexpectedly. P2 covers incorrect information,
accessibility, and state consistency. P3 covers polish. Dependency tasks inherit
the urgency of the fixes they enable.

| ID | Priority | Finding / intended outcome |
|---|---|---|
| A01 | Foundation | Consistent resource states, request ownership and related-resource invalidation |
| A02 | Foundation | Validated mapper boundaries; method/payload-aware contracts and realistic mocks |
| A03 | Foundation | Reproducible local browser regression harness with no hardware access |
| R01 | P2 | Signal colours and legend use one documented, boundary-tested policy |
| R02 | P2 | 5G SA cell-lock requests, configured locks and observed primary cells are distinct |
| R03 | P1 | Band and other form drafts survive background refreshes |
| R04 | P2 | Missing usage counters remain unavailable rather than becoming zero |
| R05 | P2 | Billing dates, reset enablement and counter-period labels reflect the device |
| R06 | P2 | Home cannot turn an absent/ghost carrier into excellent signal |
| R07 | P2 | Secondary read failures cannot masquerade as empty data or endless loading |
| R08 | P2 | APN activation refreshes both mode and profile state |
| R09 | P2 | Wi-Fi TX power displays and saves the actual supported value |
| R10 | P2 | USB UI offers only supported operations and distinguishes scheduled from active |
| R11 | P1 | Connection-dropping actions explain consequences before submission |
| R12 | P2 | Alert dismissal lasts for one episode and does not suppress later incidents |
| R13 | P2 | Wi-Fi advice uses actual observations and comparable channel-width units |
| R14 | P2 | SMS filters, refreshes and mutations cannot race or falsify unread state |
| R15 | P2 | Charge-limit editing cannot send incidental or stale writes |
| U01 | P2 | Visible focus meets the documented contrast target in both themes |
| U02 | P2 | Confirmation dialogs contain/restore focus and settle reliably |
| U03 | P2 | Tabs, selection controls and field labels expose their meaning to assistive technology |
| U04 | P2/P3 | Async feedback is accessible; redundant success toasts are removed |
| U05 | P2 | Signal help works with keyboard/touch and stays inside the viewport |
| U06 | P2 | Touch hit areas meet the Hallmark target without overlapping |
| U07 | P2 | Remaining tables become complete stacked mobile rows |
| V01 | Release gate | Cross-screen regression, documentation, and separately authorised device validation |

The original Hallmark tally was six major categories and one minor category,
with no critical category. That was an audit grouping, not a task count. Shared
interaction semantics split into several tasks here. R15, detailed field-label
omissions, Router/TTL loading cases, SMS unread behaviour, reset-configuration
fallbacks, and SA/NSA lock-source mixing are related cases confirmed during this
handoff, not claims of additional live-device failures.

## Execution sequence and ownership

Implement in small reviewable changes. Give one agent ownership of shared files
such as `api.ts`, `types.ts`, `controls.tsx`, `feedback.tsx`, and the fixture
registry; other agents should return patches or coordinate before editing them.

1. **Baseline and foundations:** record the commit, working-tree state and
   existing test results. Establish A03 and the minimum A01/A02 helpers needed
   by the first fix. Do not delay concrete fixes for a broad abstraction pass.
2. **Protect user intent:** U02, R03, R11 and R15. U02 is a prerequisite for new
   confirmations; A03 provides safe evidence that Cancel sends no mutation.
3. **Correct observations:** R04–R10 and R13, with A02 fixtures. R05 depends on
   R04; R06 and R01 must agree on unknown signal values. R08 depends on A01.
4. **Radio semantics:** R01 and R02 after the shared types/draft ownership are
   ready. R02 can be complete for truthful UI behaviour while hardware efficacy
   remains explicitly unverified.
5. **Concurrency and presentation:** R12, R14 and U01/U03–U07. These can run in
   parallel in separate files after shared component interfaces are agreed.
6. **Integration:** V01. Complete local checks and review before proposing any
   separately authorised deployment or device-changing acceptance test.

For every task, report: finding ID, files changed, before/after behaviour,
meaningful regression evidence, commands/results, and remaining limitations.
Do not mark tasks complete using screenshots alone where correctness depends on
request ordering or payloads. Conversely, Node tests alone do not validate
keyboard focus, screen-reader announcements, colour rendering or mobile fit.

## A01 — Resource states and request ownership

**Code anchors:** `web-app/src/data/poll.ts`, `pollScheduler.ts`,
`app/HomeContext.tsx`, and secondary feature read handlers.

Introduce or reuse a small shared resource model that can express:

- Initial loading with no data.
- Successful data, including a genuinely empty collection.
- Refreshing while retaining the last successful data.
- First-load failure with error and retry.
- Refresh failure with explicitly stale last-good data and retry.

Keep observation, editable draft, mutation progress, and derived presentation
separate. Do not use a successful empty array as an error sentinel. Do not
populate a form with plausible defaults when its initial settings read failed.

Use request generations/revisions so obsolete completions cannot publish data,
errors, loading changes or mutation results into the current resource. Resource
keys must include parameters that affect the result. On a key change, select
the matching cached value or initial state immediately; do not show another
key's data until the request finishes. One-shot reads need ownership and retry,
but do not need polling merely to reuse this model.

Retain the scheduler's single in-flight request, single timer, visibility pause,
queued refresh, mutation revision and stop/unmount guarantees. Existing poll
cache entries alone are not a cross-component invalidation bus. For related
resources such as APN mode/profiles, prefer one explicit owner and one
coordinated refresh unless a small shared invalidation mechanism is necessary.

**Required regression cases:** first failure; success then refresh failure;
successful empty result; retry recovery; parameter change; unmount in flight;
older success/failure after a new request; pre-mutation response after a
successful mutation; independent source failure. Preserve all existing
`tools/test-poll.cjs` tests. Assert request counts and published values, not
internal variable names.

## A02 — Mapper and API contract fidelity

**Code anchors:** `web-app/src/data/api.ts`, `types.ts`,
`web-app/tools/test-mappers.cjs`, `test-client.cjs`, `mock_agent.py`,
`scripts/check-api-contract.py`, and relevant Rust response constructors.

1. Keep the public endpoint bindings in `api.ts`. Extract domain helpers only
   when that makes validation or testing clearer. Move firmware-specific APN
   transformations out of `ApnTab.tsx` into the data layer.
2. Validate objects, arrays, finite numeric values, booleans and documented
   numeric-string forms at the boundary. Types/casts alone are not validation.
   `null`, missing, malformed, zero, false and an empty successful list must
   remain distinct where their meanings differ. Avoid `Number(null)`,
   `Number('')`, truthiness defaults and blind `as` casts for measurements.
3. Preserve compatibility with supported firmware shapes. Ignore additional
   unknown fields, but reject or mark unavailable malformed fields that the
   view relies on. Do not make the entire dashboard unavailable because one
   optional source has a bad field.
4. Extend the contract checker to compare **HTTP method plus path**, retaining
   its current checks for missing/stale routes. Do not hardcode the current
   route count. Cover bindings in both `api.ts` and `client.ts`, explicit
   `req(...)` calls, and supported mock handlers. Do not let a new regex silently
   skip a binding syntax; either constrain and test extraction or use a small
   explicit contract representation validated against the actual bindings.
5. Add secret-free fixtures with provenance notes: synthetic; or sanitised shape
   based on HK B04, with all identifiers/content replaced. Cover SA, NSA, LTE,
   disconnected, unmeasured SCC, partial sources, null counters, reset states,
   APN, Wi-Fi capabilities and scheduled USB results.
6. Reuse fixtures across mapper/mock/contract tests where practical. Pin the
   Rust-generated fields actually consumed by the UI using pure response
   construction tests. Pass-through firmware payloads need compatibility
   fixtures, not an assertion that Rust guarantees every optional firmware key.
7. For tested mutations, the mock must record method/body and update simulated
   read-back state. APN activation must change mode to manual; Wi-Fi TX writes
   must affect the next read; lock submission must be separable from serving
   cell change. A blanket `{ok:true,data:{}}` is not sufficient evidence.

**Acceptance:** a deliberately mismatched GET/PUT fails the checker; missing
required response fields fail the relevant contract/mapper test; unknown
optional fields remain compatible; nulls stay unknown; mutation/read-back
fixtures reproduce the actual cross-resource effects. Restore any deliberate
test mutations immediately and never commit them.

## A03 — Local regression harness

The dashboard currently uses Node's built-in test runner and TypeScript/VM
loading in `web-app/tools/test-*.cjs`; it has no DOM/browser test framework.
Keep those tests for pure mappings, classifiers and state transitions.

Add a minimal **development-only** browser regression harness, preferably
`@playwright/test`, because polling races, focus containment and real layout
cannot be adequately verified with the current Node suite. This dependency is
justified by those behaviours; do not add a second overlapping component-test
stack or production runtime dependencies. Use an existing equivalent harness
if one has appeared since this baseline. Pin dependencies in the lockfile and
document the browser installation/test commands actually selected.

Suggested layout: `web-app/tests/browser/`, a Playwright configuration in
`web-app/`, and an `npm run test:browser` command. Bind the test frontend to
`127.0.0.1` on a dedicated strict port. `API_BASE` derives from the page hostname,
so browser request interception can fulfil `http://127.0.0.1:9090/api/...`
without changing the production client or running a real agent.

Harness requirements:

- Block service workers and unexpected external network requests. Only local
  static assets and explicitly registered synthetic API fixtures may succeed.
  Fail on any unhandled API method/path; never fall through to a real network.
- Supply fake session credentials or a mocked login. Never reuse a browser
  profile/session from the owner's live dashboard. Keep fixture state isolated
  per test and clean up only processes the harness itself starts.
- Record requests, defer chosen responses and inject failures. Simulate poll
  progression with controlled time or explicit completion signals; avoid long
  sleeps and timing-dependent assertions.
- Provide helpers for both themes, reduced motion, viewport sizes, successful
  empty responses, first-load failure, stale refresh and mutation read-back.
- Keep screenshots/traces synthetic. Configure failure artefacts and CI so
  debugging a test does not require reproducing it against hardware.
- Add the browser command to CI after it runs reliably locally. A documented
  manual accessibility pass remains necessary; automation does not prove
  screen-reader usability.

Suggested test ownership and files (reuse an equivalent existing file instead
of creating duplicate suites):

| Coverage | Pure/contract tests | Browser tests under `tests/browser/` |
|---|---|---|
| R01/R04/R05/R06 | Extend `tools/test-mappers.cjs`; add `tools/test-signal-quality.cjs` and date/usage helper tests | `telemetry.spec.ts` |
| A01/R03/R12 | Extend `tools/test-poll.cjs`; add resource/draft/alert transition tests | `resource-states.spec.ts`, `drafts.spec.ts`, `alerts.spec.ts` |
| R02 | Cell request/lock mapper tests; Rust cache-invalidation/validation tests | `cell-lock.spec.ts` |
| R08/R09/R13/R14 | Domain mapper/request-body tests and fixture state transitions | `apn.spec.ts`, `wifi.spec.ts`, `sms.spec.ts` |
| R10/R11/R15 | Capability/commit-decision tests where logic is extracted | `device-actions.spec.ts` with every API mutation intercepted |
| U01–U07 | Focus contrast calculations where useful | `accessibility.spec.ts`, `responsive.spec.ts` plus manual assistive-technology checks |

Test names should describe the user-visible failure they prevent. Share fixture
builders, not implementation logic that would let both production and tests
repeat the same mistake. Use explicit expected boundary values and response
ordering in tests rather than computing expected results with the function
under test.

## R01 — One signal-quality policy, legend and set of boundaries

**Code anchors:** `web-app/src/format.ts` (`rsrpQuality`, `rsrqColorClass`,
`sinrColorClass`, quality label/colour helpers),
`features/signal/Overview.tsx` (desktop/mobile measurements and legend),
`features/home/HomePage.tsx`, `web-app/design.md`.

**Confirmed current behaviour:** Rust supplies telemetry, not traffic-light
ratings. The frontend applies the same rules to LTE and NR:

| Metric | Current green | Current orange | Current red |
|---|---|---|---|
| RSRP | `x > -90 dBm` | `-100 < x <= -90` | `x <= -100` |
| RSRQ | `x > -10 dB` | `-15 < x <= -10` | `x <= -15` |
| SINR | `x > 15 dB` | `5 < x <= 15` | `x <= 5` |
| RSSI | No rating; neutral text | No rating | No rating |

The current SINR legend instead describes Good at 10–20 dB and Fair at 0–10 dB.
That contradicts the classifier. RSRQ is also stricter than common vendor
guidance that treats roughly -10 to -15 dB as good. These are product heuristics,
not a universal 3GPP traffic-light standard or a throughput guarantee.

**Recommended implementation policy:** adopt this explicit inclusive table and
document the intentional change at exact boundaries. This aligns SINR with the
existing legend's intended ranges and makes good RSRQ green. It is a product
choice; do not claim that all vendors or all NR measurement types use it.

| Metric | Excellent / green | Good / green | Fair / orange | Poor / red |
|---|---|---|---|---|
| RSRP, dBm | `x >= -80` | `-90 <= x < -80` | `-100 <= x < -90` | `x < -100` |
| RSRQ, dB | `x >= -10` | `-15 <= x < -10` | `-20 <= x < -15` | `x < -20` |
| SINR, dB | `x >= 20` | `10 <= x < 20` | `0 <= x < 10` | `x < 0` |

Keep RSSI neutral: it includes desired signal, interference and noise, and is
bandwidth-dependent. Strong RSSI or RSRP alone does not imply good SINR. Do not
alter measurement values, turn all metrics green because speed is good, or
infer whether NR fields are SS- or CSI-based unless the firmware establishes it.

Implementation requirements:

1. Put thresholds, units and quality labels in one typed data definition. Derive
   both classifiers and legend text from it. Share it between Home, desktop
   tables and mobile cards. Do not leave duplicate numeric thresholds in JSX.
2. Unknown, non-finite and firmware-unmeasured values receive a neutral state
   and an unavailable label. Keep sentinel rejection in the mapper; do not
   classify placeholder zero RSRP as an excellent real observation. Zero SINR
   is a valid reading and must not be treated as absent.
3. Preserve raw numeric readings, precision and units. Show a quality word or
   accessible description as well as colour. Choose one consistent label for
   the `poor` category instead of mixing unexplained “Weak”/“Poor” wording.
4. Explain briefly that ratings are approximate link indicators. Retain neutral
   idle/unmeasured SCCs. A different future LTE/NR policy must be explicit and
   evidence-backed rather than an undocumented branch.

**Regression cases:** for each threshold test just below, exactly at, and just
above it; test null/undefined/NaN/infinity and accepted numeric-string inputs
at the mapper. Assert classification labels and generated legend boundaries.
Under the recommended policy, `RSRP=-54`, `RSRQ=-13`, `SINR=7.5`, `RSSI=-49`
renders green/green/orange/neutral; `SINR=3` is orange and `SINR=12` is green.
Test both themes and both carrier layouts. Verify no raw telemetry changes.

## R02 — Truthful NR locking and primary-cell verification

**Code anchors:** `features/signal/Locking.tsx` (`CellLock`, `ServingCells`,
`handleLockCell`, resets), `data/api.ts` (`mapSignal`, `cellLockNr`), `types.ts`,
`agent/src/cell.rs` (`cell_lock_nr`), and reference `zte-script-ng.js`.

**Established capability:** the existing request is `POST /api/cell/lock/nr`
with string fields `lock_nr_pci`, `lock_nr_earfcn`, `lock_nr_cell_band`. Rust
forwards it to `zte_nwinfo_api.nwinfo_lock_nr_cell`. The vetted reference and
static firmware evidence support an SA cell-lock path. No live lock was tested.
There is no verified API that guarantees promotion of a chosen aggregated
secondary carrier to primary while retaining the same aggregation set.

The primary NR tuple comes from `nr5g_pci`, `nr5g_action_channel`, and
`nr5g_action_band`. Keep the distinction between **requested target**,
**configured lock**, and **observed primary cell** visible and typed.

Implementation requirements:

1. Keep the control named “NR cell lock” or similarly precise wording. Explain
   that it requests a serving-cell constraint, can reconnect the link, and does
   not guarantee primary selection or a particular aggregation combination.
   Do not add a “Make primary” button promising an unverified result.
2. Retain the existing safe ubus surface. Validate integer PCI/ARFCN/band values
   before submission against documented NR ranges and actual supported bands;
   NR PCI 0 is valid and 1007 is the upper PCI bound. Reject decimals, negatives,
   malformed input and unsupported bands. Do not copy LTE ranges to NR or add
   new AT commands. If strengthening backend validation, test it with pure
   parsers and keep the existing request compatibility.
3. Map firmware `lock_nr_cell` read-back only after establishing its actual
   format from safe reference/fixtures. Distinguish absent/unparseable data
   from a known cleared lock. Preserve unknown status when the firmware does
   not provide enough evidence; never reconstruct a confirmed setting solely
   from the submitted request.
4. On acknowledgement, say “Lock request accepted; checking serving cell”.
   Reuse `useHome().refresh()` and subsequent heartbeat results, avoiding extra
   radio pollers. Only fresh results acquired after submission can verify the
   target. Compare the entire normalised band + NR-ARFCN + PCI tuple.
   Specifically, a later HTTP response with `stale:false` can still contain a
   pre-mutation sample from the one-second radio cache. Prefer invalidating
   `state.radio` via its existing `Observed::invalidate()` after a successful
   lock/reset mutation, then use request revisions to discard older in-flight
   dashboard reads. The next successful source acquisition supplies verification
   evidence; a failed acquisition retaining last-good data does not. An
   alternative must prove equivalent sample-generation ordering. HTTP arrival
   time alone and device-versus-browser wall-clock comparisons are insufficient.
5. Track request pending, accepted/unverified, configured if readable, observed
   on target, and request/read-back error independently. If the primary tuple
   matches, say “Serving on requested cell”; do not infer successful persistent
   lock solely from a matching cell. If it does not match after a bounded
   observation window (30 seconds of visible observation is the proposed
   default), say “Requested cell not observed” with the actual current cell.
   Do not resend the mutation or toggle network mode automatically.
6. Preserve the target while a request is pending and prevent duplicate or
   conflicting submissions. A disconnect after acceptance is a verification
   uncertainty, not automatic proof that the request failed or succeeded.
7. Rename “Active cells” to “Reported serving/aggregated cells” or equivalent.
   Mark PCC/SCC and active/idle/unmeasured separately. Idle SCCs are not proof
   of usable standalone primary cells. Row actions should open the same
   reviewed target/confirmation flow, not perform an immediate silent lock.
   Invalid/missing tuples cannot be submitted; an idle tuple may only be offered
   with explicit unverified-target wording and the same confirmation.
8. Unlock/reset must also use read-back and honest requested/observed states.
   Do not assume an immediate return to the former primary cell. Preserve the
   distinction between the band-reset and cell-reset endpoints; verify their
   returned/observed effects rather than claiming unrelated locks were kept.
9. The existing capability `nr_nsa_band_lock_supported=false` describes **band**
   locking. Do not reinterpret it as proof about every NR cell-lock operation.
   The requested primary-cell validation in this plan is specifically SA.

**Regression cases:** exact request method and string keys; PCI 0/1007 and
invalid values; accepted request without a cell change; same PCI on a different
ARFCN/band; configured lock differing from observed PCC; stale pre-request
response; missing/malformed lock read-back; target becoming observed; timeout;
network failure after acknowledgement; explicit API rejection; reset read-back;
idle SCC selection; repeated click producing one request. Manual and row-based
flows must share the same state model. Mock every mutation.
Include an immediate post-submit dashboard response marked fresh but carrying
the old cached tuple, and a failed post-invalidation acquisition returning
last-good data: neither can verify the new request.

**Hardware limitation:** acceptance of this UI fix does not prove that an
arbitrary SCC can become PCell. V01 defines the separately authorised trial.

## R03 — Preserve drafts through polling and related changes

**Code anchors:** `Locking.tsx` (`BandLock` effect and selection handlers),
`data/api.ts` (fresh lock arrays on each `mapSignal` call),
`WifiTab.tsx` (`BandCard` draft initialisation), and other touched forms.

Store the latest successful observed value, an editable draft, dirty status and
pending mutation separately. Compare band sets semantically using a sorted,
deduplicated representation; object/array identity is not a setting change.

- Initialise a pristine draft from a successful observation. Update a pristine
  draft when authoritative values actually change. Equivalent heartbeat arrays
  must not replace it or trigger unnecessary work.
- Preserve a dirty draft when a poll or sibling-band refresh arrives. If the
  device actually changes that setting externally, show the new observed value
  and a concise conflict/reload option. Cancel restores the latest observation.
- A known unlocked/automatic band state must clear the observed selection and
  a pristine draft. Missing lock data is “unknown”, not proof of unlock. Replace
  the current mapper/type ambiguity with explicit `unknown`, `automatic`, and
  `locked` states, using verified firmware encodings for automatic selection.
  Parse SA and NSA lock observations separately: the current
  `nrSaStr || nrNsaStr` fallback can substitute an unrelated NSA value into the
  SA control. A known empty SA value must not inherit NSA bands; missing SA
  stays unknown. The SA setter's baseline must come from SA state.
- Submit an immutable snapshot of the visible draft once. Disable conflicting
  controls while pending or explicitly support a newer draft; do not let a poll
  change the body between confirmation and submission.
- On failure keep the draft for correction/retry. On success use authoritative
  return data or fresh read-back to establish the new baseline. Old in-flight
  observations cannot restore the previous selection.

**Regression cases:** edit LTE and NR locks across at least three equivalent
heartbeat responses; real external change with pristine/dirty drafts; Cancel;
successful apply/read-back; failed apply; reset to automatic; missing read-back;
refresh 2.4 GHz after saving it while preserving an unsaved 5 GHz edit. Assert
the actual submitted body equals the visible selection.
Also test known-empty SA with nonempty NSA, missing SA with nonempty NSA, and
independent SA/NSA observations during a network-mode transition.

## R04 — Preserve unavailable usage counters

**Code anchors:** `agent/src/handlers.rs::read_data_usage_live`,
`data/api.ts::mapDataUsage`, `types.ts::UsagePeriod`/`DataUsage`,
`features/modem/DataTab.tsx::UsageTotals`, and Home usage presentation.

Rust deliberately emits JSON null for missing/unparseable counters. The mapper
currently converts them to zero. Make byte/time fields explicitly nullable or
optional throughout the UI and accept only valid finite non-negative values.
Validate period objects before reading them; a missing `day`, `month` or `total`
must not crash the mapper.

Render unavailable values as an em dash/“Unavailable”. A genuine measured zero
must still render `0 B` or zero time. Calculate a total only when both RX and TX
are known; otherwise show an unknown total while retaining any known component.
Do not silently use one direction as the total. Charts, percentages and other
derived values must propagate the same uncertainty.

Use source freshness to distinguish stale last-good values from newly measured
ones. Do not change correct agent counters merely to simplify frontend types.

**Regression cases:** all-null period; missing period; one missing direction;
zero in both directions; valid number/numeric string; malformed string/negative
or non-finite number; known RX with unknown TX; valid stale last-good data.
Check Home and every DataTab counter layout. No `NaN`, fabricated zero total,
or invalid time string may reach the screen.

## R05 — Device-backed billing/reset state and period labels

**Code anchors:** `DataTab.tsx::cycleWindow` and current-cycle rendering,
`HomePage.tsx` usage label, `api.ts::mapDataUsage`,
`handlers.rs::read_data_usage_live` and reset-day setter.

The UI currently calculates a period from the browser date and always promises
a monthly reset. The agent already returns `reset_enabled`, `reset_day`,
`clear_date_record`, and `next_clear_date`. `month` and `cycle` use the same
firmware month counters; `since_power_on` currently uses firmware `real_*`
connection counters.

1. Use observed enablement and valid authoritative cycle dates. When reset is
   disabled, say “Automatic reset disabled”; do not display a scheduled next
   reset or claim monthly resets still occur. Missing enablement should remain
   unknown rather than being silently mapped to disabled.
   This requires a narrow agent correction too: `read_data_usage_live` currently
   fabricates reset day `1` and enablement `0` when both ubus and fallback UCI
   reads fail. Preserve null/unknown in that case. Keep valid fallback UCI
   observations, validate day 1–31 and recognised enablement values, and return
   successfully read usage counters even when reset configuration is unknown.
   Coordinate the nullable response contract, mapper, mock, docs and Rust
   response-construction tests; the frontend cannot recover lost provenance
   from fabricated numeric defaults.
2. Establish date formats from safe reference/fixtures before parsing. Treat
   date-only strings as calendar dates, not UTC instants that shift a day in a
   different browser timezone. Do not apply a guessed device UTC correction.
3. If a date is missing/invalid, show unavailable. If an estimated fallback is
   retained for a clear product reason, label it “Estimated” and never let it
   override a supplied authoritative date. Do not invent an actual last reset
   from the configured reset day.
4. Label Home's reused monthly/cycle total “Current cycle” or “Device cycle”
   consistently with DataTab. “This month” is misleading for a mid-month reset.
5. Verify `real_*` reset semantics from the firmware reference or an authorised
   observation. Until power-on lifetime is established, use neutral wording
   such as “Connection counters” instead of “Since power on”. Document the
   source/reset semantics; do not rename the API field without a compatibility
   reason and a coordinated contract update.
6. A reset-day mutation must display its actual enablement effect, use the
   authoritative returned state/read-back, and invalidate the shared dashboard
   copy. Do not create an independent usage poll. Explain the mutation's known
   consequences before submission if it changes or resets counters; do not assume
   it is a harmless local preference.

**Regression cases:** enabled/disabled/unknown reset; mid-month cycle; browser
timezone differing from the router; date-only values; missing/malformed dates;
year rollover; February/leap year and days 29–31 if calculations remain; stale
dates; reset-day save success/failure and read-back failure. Verify Home and
DataTab agree. Do not claim reconnect resets only at power-on.
Include successful usage counters with both ubus and UCI reset-configuration
reads failing, and ubus failure with a valid UCI fallback. The former displays
unknown configuration, not day 1 / reset disabled; the latter uses the actual
fallback values.

## R06 — Select a real serving measurement for Home

**Code anchors:** `api.ts::mapSignal`, `HomePage.tsx` primary and `pccRsrp`
selection, `types.ts::CarrierComponent`/`SignalInfo`.

The carrier parser can discard a ghost LTE carrier while leaving raw
`signal.rsrp=0`. Home falls back to that raw value and can call a disconnected
or unmeasured signal excellent.

Choose the relevant primary carrier from validated observations and network
mode: LTE for LTE/NSA anchor presentation and NR for SA. If an NSA view chooses
to show NR instead, label that explicitly; do not silently pick whichever raw
field happens to exist. Eliminate the unvalidated fallback or replace it with
a mapper-derived valid primary observation. Missing measurement stays neutral.

Keep PCI 0 valid, preserve full 36-bit NR cell IDs, and retain current suppression
of idle NR SCC reporting floors. Do not reject real negative readings simply
because they are poor. Align “reported carriers” versus active/measured counts
and bandwidth copy when idle SCCs are included; do not call them all active.
Missing signal bars must remain unknown rather than displaying a measured
`0/5`; a genuine zero-bar observation remains valid. Do not hide a valid PCI 0.

**Regression cases:** SA with unused LTE zero fields; disconnected all-zero
payload with no valid carrier tuple; LTE-only; NSA; valid primary with missing
RSRP; idle SCC floors; valid PCI 0; NR cell ID beyond 32 bits. Home and Signal
must use the same underlying measurement and never manufacture excellent
signal. Test missing versus genuine zero bars and preserve the existing mapper
tests for NR IDs and idle SCCs.

## R07 — Honest secondary-page read states

**Code anchors:** `SmsTab.tsx`, `ApnTab.tsx`, `WifiTab.tsx`, `ClientsTab.tsx`,
`RouterTab.tsx`, `TtlTab.tsx`, `Locking.tsx` capabilities, and related Settings/
Metrics resource reads. Apply A01; do not create another competing abstraction.

| Surface | Current problem | Required result |
|---|---|---|
| SMS list | Failure becomes `[]` / “No messages” | Error/retry or stale messages; empty only after successful empty response |
| APN profiles | Failure becomes “No manual profiles” | Error/retry or stale profiles; independent mode status |
| Wi-Fi | Read error swallowed; skeleton remains | Loading ends with error/retry; preserve stale successful settings |
| Clients | Poll error ignored | Stale count/list marked; USB-status failure distinct from clients failure |
| Router DNS/LAN | Failed read leaves plausible editable defaults | Unknown baseline with error; disable baseline-dependent submit |
| TTL | Failure leaves “Checking status” | Error/retry; unknown is not “disabled” |
| Lock capabilities | Failure lacks in-place retry | Retry plus unavailable controls; no fabricated supported bands |
| USB/charge/system reads | Some failures hidden or controls disappear | Source-specific unavailable/stale states without changing protected backend logic |

Audit each listed consumer for independent source failures; one successful
dashboard heartbeat must not hide an unrelated feature error. Keep last-good
data useful but visibly stale. Disable actions requiring a current trustworthy
baseline/capability; preserve explicit actions that remain valid without it.
Do not disable the whole application because one optional source is unavailable.

**Acceptance matrix, for each affected resource:** initial success; successful
empty if applicable; first-load failure; refresh failure after success; retry
recovery; malformed payload; stale response after unmount/key change. The screen
must not show indefinite loading, false empty state, fake default settings, or
silent stale success. Test with a healthy dashboard heartbeat throughout.

## R08 — Keep APN mode and profiles coherent

**Code anchors:** `ApnTab.tsx::ApnMode`/`Profiles` and activation handler,
`agent/src/router.rs` APN activation (sets manual mode before enable), APN
endpoint bindings/mappers.

Own mode and profile observations together, or explicitly refresh both after
activation/mode changes. Activating a manual profile must update the displayed
mode to the observed manual state and make returning to Automatic possible.
Serialise conflicting activation/mode operations across the two panels.

Use validated mode values; a missing `apn_mode` is not automatic mode. Separate
mutation acceptance from subsequent read-back failure. Preserve draft profile
inputs on a failed save. Do not “fix” this UI discrepancy by removing the
backend's stock-compatible manual-mode transition or rollback behaviour.
Apply R11's pre-submission warning for reconnecting APN changes.

**Regression cases:** automatic → activate profile → manual; manual → automatic;
activation failure with backend rollback; accepted activation plus failed
read-back; old mode response arriving after activation; malformed mode value;
rapid conflicting clicks. Exactly one intended mutation is sent and both
panels eventually reflect authoritative state or explicitly unverified state.

## R09 — Actual Wi-Fi TX power, with no invented default reset

**Code anchors:** `agent/src/wifi.rs` Wi-Fi status fields and TX validation,
`api.ts::mapWifi`, `types.ts::WifiBand`, `WifiTab.tsx` band draft/save and TX
power select.

The agent returns `txpower_2g`/`txpower_5g`; the mapper discards them. The form
initialises blank “Default” and omits blank from the mutation. Thus reopening
a saved 25% setting looks like Default, and choosing Default does not reset it.
The verified setter accepts explicit integers **1–100**, not a default-reset
operation.

1. Map validated observed TX percentage into each band. Initialise a pristine
   draft from it and retain it through R03's dirty-draft handling.
2. Prefer an explicit 1–100% input or a select that can represent any observed
   valid value, including 60% when it is not a preset. Never snap a value to the
   nearest preset or imply a percentage is a dBm measurement.
3. Unknown TX remains unknown. If omission is offered, label it “Keep current”
   and make its behaviour explicit. Do not label omission “Default”. Do not
   call 100% the factory default without evidence.
4. Submit only intentional changes, with explicit numeric percentage semantics.
   A save of unrelated Wi-Fi settings must not reset TX power. Re-read settings
   after acknowledgement; read-back failure remains unverified/stale.
5. Do not add a firmware reset command to support the old UI label. A future
   default-reset feature requires separate evidence of its stock semantics.

**Regression cases:** saved 25% reopens as 25%; observed 60% remains editable;
explicit 100 sends 100; unchanged or “Keep current” omits TX; missing/invalid TX
does not become 100/default; values 0/101/decimal are rejected; independent
2.4/5 GHz values stay separate; failed save preserves draft; read-back failure
does not falsely confirm the new value. Confirm the exact field suffix in the
request body for each band.

## R10 — USB capabilities and scheduled-state truthfulness

**Main-agent-owned backend review.** Expected change is primarily frontend.

**Code anchors:** `features/system/SettingsTab.tsx::UsbSection`,
`types.ts::UsbStatus`, `api.ts::usbStatus`/`usbMode`,
`agent/src/usb.rs::usb_status`/`usb_mode_set` (read to preserve behaviour).

The UI bypasses capability checks for Debug (ADB), while the setter accepts
ECM/RNDIS and the guarded NCM path and rejects `debug`. Remove the unconditional
Debug affordance or show it disabled with an accurate unsupported explanation.
Do not implement a debug composition to make the button work.

Use the agent's capabilities as the authority. If a per-mode capability says
unsupported, a contradictory fallback list must not re-enable it. When a newer
capability object is absent, use a documented supported-modes fallback; failed
status must not fabricate support. Provide an explicit unavailable/retry state.

Keep **active mode**, **scheduled requested mode**, and **persistent boot
default** separate. Parse the existing scheduled result rather than showing an
immediate active-mode claim. After a scheduled switch, perform bounded status
rechecks using a secondary resource owner; this does not justify another
dashboard heartbeat. Stop on verified state, explicit error, timeout or unmount.
Show a reconnect/unverified state when the management path disappears. Do not
repeat the mode mutation automatically.

Retain experimental confirmation, firmware preflight/rollback and charge-state
guards. Explain an actual connection-disrupting transition before submission,
including NCM → ECM rollback where applicable. Do not claim a reboot requirement
or a completed transition unless supported by the operation's response/state.

**Regression cases:** capabilities without Debug; unsupported/missing NCM;
capability false versus list fallback; status failure; scheduled NCM with old
active status followed by NCM; scheduled switch failure; read-back timeout;
active NCM with ECM scheduled; boot default differing from active mode; repeated
click; component unmount during verification. Assert no `mode: 'debug'` request
is possible. All transitions are mocked; no live USB composition test is part
of the default acceptance suite.

## R11 — Confirm connection-dropping changes before submission

**Code anchors:** `WifiTab.tsx` master/per-band toggles, save and band sync;
`ApnTab.tsx` activation/mode changes; `Locking.tsx` network/band/cell actions;
`SettingsTab.tsx` USB transitions; shared `ui/feedback.tsx`.

The confirmed Wi-Fi issue is immediate mutation followed by an explanatory
toast after management may already have disconnected. Apply the locked design
rule consistently to operations known to reconnect or drop management.

1. Classify changes using their actual endpoint behaviour. Wi-Fi disable,
   radio/security/SSID/channel changes, band sync and any save that reloads
   wireless can disconnect clients. APN/network/band/cell selection can
   interrupt WAN even when the local management page remains reachable.
2. Before submission show the operation, affected radio/profile/cell, likely
   interruption and practical recovery path. Distinguish loss of Internet from
   loss of access to the dashboard. Do not guess that the browser is on USB or
   on a particular Wi-Fi band. Do not echo passwords into confirmations.
3. Keep confirmations limited to irreversible or connection-dropping actions.
   Do not confirm theme selection, navigation, ordinary reads, or draft edits.
   Use U02's accessible shared dialog; do not add per-screen modal copies.
4. Freeze the reviewed payload for that confirmation. Cancel/Escape/backdrop
   must submit nothing. Confirm submits it once and locks conflicting controls
   while pending. Do not silently apply a newly polled or edited value instead.
5. After acknowledgement distinguish request acceptance from verified state.
   If connectivity disappears, retain a clear pending/reconnect instruction;
   do not automatically retry a mutation with an uncertain result.
6. Preserve existing backend transactional rollback. Do not change
   `DESTRUCTIVE_PATHS`, authentication, or backend safety classification just to
   implement a frontend confirmation. Any such backend change requires its own
   main-agent review and evidence.

**Regression cases:** for every affected mutation handler, Cancel sends zero
requests; Confirm sends exactly one reviewed payload; repeated clicks cannot
double-submit; pending reconnect is comprehensible; failure leaves an actionable
state; settings changes during an open dialog cannot alter its payload. Verify
master Wi-Fi off, per-band off, SSID/security save, band sync, APN activation,
network mode and cell-lock flows entirely against the mock.

## R12 — Alert identity, dismissal and recurrence

**Code anchors:** `app/HomeContext.tsx::Alert`/`deriveAlerts`/`useAlerts`,
`app/Shell.tsx::AlertBanner`.

Replace message-string identity with a stable condition ID, e.g.
`source:signal`, `dashboard:refresh`, `battery:temperature`. Separate ID,
severity, current message and episode state. Never include age, temperature or
percent in the identity itself.

A dismissal suppresses the current condition at its current severity for the
current episode. Routine age/value text updates do not re-show it. An observed
recovery clears the dismissal, so the same error later appears again. A warning
escalating to error must appear even if the warning was dismissed. Treat an
unknown/failed observation as unknown, not proof of recovery; only clear an
episode when its source can actually establish that the condition resolved.

Keep stale/source status discoverable even after banner dismissal. Avoid
re-announcing the entire alert on every heartbeat as elapsed seconds change;
announce new episodes and severity changes, while keeping visual detail current.
Do not change the existing thermal/battery thresholds as part of this task.

**Regression cases:** dismiss → age changes → remains dismissed; successful
recovery → identical error recurs → visible; dismissed warning → error → visible;
one source dismissed while another fails; unknown source during an active
episode; no repeated live-region announcement for unchanged episode. Test both
pure episode transitions and the browser banner.

## R13 — Evidence-based Wi-Fi guidance and channel-width comparison

**Code anchors:** `WifiTab.tsx::getBandInsights` and fallback advice text;
`api.ts` Wi-Fi configured/runtime mapping and width formatting helpers.

The UI has no neighbouring-AP measurement but says “No obvious channel conflicts
detected”. Replace that with text limited to configuration observations, such
as “No configuration advice for these settings”, or omit the empty advice row.
Do not add radio scanning or active interventions just to justify the old copy.
Client count alone is not evidence that a fixed channel will improve stability;
remove or accurately qualify that recommendation.

Normalise configured and observed widths into comparable numeric MHz values,
while retaining PHY mode separately. `HE80` versus `80 MHz` is not a mismatch;
`HE80` versus `40 MHz` is. Distinguish “Configured” and “Current” values. A real
temporary difference is an observation, not automatically a firmware fault.
Unknown/malformed data must not create a warning.

**Regression cases:** HE80/80 MHz and EHT160/160 MHz agree; HE80/40 MHz differs;
missing/invalid runtime width is unavailable; automatic channel and DFS
messages remain factual; ordinary fixed channel without scan data never claims
interference was measured or excluded. No new network/device operation is sent
by rendering advice.

## R14 — SMS collection ownership, filters and mutations

**Code anchors:** `SmsTab.tsx` list loader, box selection, selected message,
mark-read, delete/send and unread count; `api.ts` SMS mappers/bindings.

One API list call already returns all messages. Store the full validated
collection and derive Inbox/Sent from the current selected box during render.
Do not filter inside an async closure that captures an obsolete box selection.
Changing boxes need not fetch the same entire list again.

Use A01's request/revision ownership for refresh and mutations. A pre-delete
list response must not resurrect a deleted message. A pre-mark-read response
must not restore obsolete unread state. Select by stable message ID and derive
the current message from the collection; clear/reconcile selection if that
message disappears. Unread count comes from the inbox collection even while
Sent is selected.

Do not silently swallow mark-read failure after showing the message as read.
Either update on acknowledgement or roll back an optimistic update and explain
the failure. Sending/deleting must preserve their existing confirmations and
firmware capability/readiness gates. R07 covers empty versus unavailable.

**Regression cases:** reverse-order list success and failure; switch Inbox/Sent
while a request is pending; send while switching boxes; old list after delete;
old list after mark-read; failed mark-read; unread count on Sent; selected
message removed on refresh; unmount in flight. Use synthetic message content
and numbers, never captured personal SMS data. Assert final visible messages
and mutation count, not just the currently selected tab label.

## R15 — Charge-limit draft and commit semantics

**Main-agent-owned implementation/review of this interaction.** Do not change
`charge_policy.rs` or charger semantics to fix frontend events.

**Code anchors:** `features/system/MetricsTab.tsx::ChargeControlCard`,
`api.ts` charge-control bindings, existing `usePoll` mutation behaviour.

The range currently writes on every `keyup`, including unrelated keys, writes
on pointer-up even if unchanged, and protects the draft from polling only while
`dragging`. Cancellation/keyboard editing can therefore send unintended or
stale values.

Prefer an explicit **Apply limit** and **Cancel** for the range draft. This is
a reversible settings edit, so it needs no additional confirmation. Pointer and
keyboard events update only the local draft; Apply sends once only when the
validated value differs from the latest observed setting. This makes the
commit boundary independent of pointer/key event quirks.

- Keep the existing 50–100 range and step 5 unless a separate evidence-backed
  requirement changes them. Polling must not overwrite a dirty keyboard or
  pointer draft. Cancel restores the latest observed value.
- On acknowledgement publish the authoritative returned charge state using
  the existing `mutate` path. On failure retain the draft and error. Prevent
  concurrent limit/toggle/manual-charge mutations from conflicting.
- Preserve disabled behaviour for unavailable hardware or disabled enforcer.
  Pointer cancellation, Tab, Escape, focus loss and unrelated keyup must never
  write settings. An explicit Cancel/Escape policy can discard the draft.
- Add a visible associated label and percent value semantics under U03. Replace
  implementation-only charger inversion prose with useful user behaviour if
  that text is touched; keep the inversion documented in developer/safety docs.

**Regression cases:** click without change; pointer cancel; arrows/Home/End
editing; Tab/Escape/unrelated keyup; poll during keyboard edit; same-value Apply;
explicit changed Apply sends once; rejected save; authoritative return differing
from draft; newer mutation versus old poll; unavailable hardware. All tests use
mock charge endpoints. Do not stop/resume charging on the real unit for UI QA.

## U01 — Focus contrast in both themes

**Code anchors:** `web-app/src/index.css` global `:focus-visible`, theme tokens,
`web-app/design.md`, and shared controls.

The current 55%-opacity outline was calculated at approximately 2.30:1 on light
surface, 2.23:1 on light background, 2.89:1 on dark surface, and 2.92:1 on dark
background. These were alpha-composite/luminance calculations, not a complete
browser accessibility audit.

Specify a shared focus token/treatment that reaches at least 3:1 against each
adjacent surface. Keep a 2px instant outline with offset and no layout shift.
Do not assume simply removing opacity works on every filled control/readout
surface; measure the actual combinations and use a two-tone treatment if needed.
Verify that field-specific `outline-none` styling does not erase keyboard focus.

**Acceptance:** visible keyboard focus on primary/danger/outline buttons, fields,
switches, tabs, band buttons and graphite surfaces; both themes; 200% zoom;
reduced motion; no clipping by containers. Save calculated ratios and browser
evidence. Test computed colours and behaviour rather than class-name strings.

## U02 — Accessible, reliable confirmation host

**Code anchors:** `web-app/src/ui/feedback.tsx::confirm`/`ConfirmHost` and all
callers. This shared fix precedes R11.

Prefer a native `<dialog>` opened with `showModal()` if supported by the target
browsers. Otherwise implement equivalent focus containment and background
inertness. Keep the promise-based caller API unless a change is justified.

- Associate title/body via stable IDs and `aria-labelledby`/`aria-describedby`.
- Initially focus Cancel for destructive or connectivity-changing actions.
  Tab/Shift+Tab stay inside; background controls cannot activate or receive
  focus. Escape and explicit Cancel resolve false.
- Preserve deliberate backdrop dismissal behaviour and test it; clicking inside
  the dialog must not cancel. Confirm resolves true exactly once.
- Restore focus to the invoking control if it still exists; otherwise choose
  a sensible surviving control. Do not jump to a removed row.
- Do not silently replace an unresolved confirmation with a new one. Choose a
  bounded policy, such as rejecting an overlapping request with false, and test
  it. Unmount must settle outstanding promises safely and remove listeners.
- Ensure opening a dialog never triggers the underlying action. Preserve all
  existing irreversible-delete/reboot/reset confirmations.

**Regression cases:** keyboard cycle both directions; Escape/Cancel/backdrop;
inside click; double Confirm; overlapping confirms; unmount while open; opener
removed; screen-reader title/description. Assert mutation request counts through
SMS delete, band/cell reset and reboot **mock** flows. Never reboot hardware for
this test.

## U03 — Tabs, selected states and labels

**Code anchors:** `ui/Tabs.tsx`, `ui/controls.tsx::Segmented`/`Field`, group
components, custom selection buttons in `Locking.tsx`/APN/Settings, and fields
in `MetricsTab.tsx`, `DataTab.tsx`, `TtlTab.tsx`, `ToolsTab.tsx`.

Tabs:

- Give each tablist an accessible name; stable tab/panel IDs;
  `aria-controls`, `aria-selected`, `role="tabpanel"`, and `aria-labelledby`.
- Use one tab stop with Left/Right wrapping and Home/End. Adopt manual
  activation consistently: arrows move focus, Enter/Space activates. Ensure
  active/focused state stays valid when the available tabs change.
- Wire the shared component API through every group. Hidden panels must not
  retain focusable descendants. Do not put tab semantics on ordinary navigation
  that does not own a tabpanel.

Selection controls:

- Exclusive segmented choices use named radio-group semantics and appropriate
  keyboard operation, preferably native radios styled to Cobalt. Multi-select
  band buttons expose `aria-pressed`; network mode exposes exclusive selection.
- Separate keyboard selection from backend submission where there is an Apply
  step. Native radio arrow keys change selection as well as focus. Therefore,
  device-changing exclusive choices, especially APN mode, must use draft
  selection plus Apply, or separate action buttons with R11 confirmation.
  Radio `onChange` must not directly submit a device mutation. Immediate local
  preferences such as theme may still update immediately.
- Disabled/selected state must be announced, not encoded only by fill colour.

Fields:

- Add real labels to reset day (`DataTab`), TTL in both active/inactive branches
  (`TtlTab`), charge-limit range (`MetricsTab`), and AT command/timeout
  (`ToolsTab`). The existing adjacent `<p>`/placeholder is not an association.
- Reuse `Field` or `label`/`htmlFor`/`aria-labelledby`; provide unique IDs where
  needed. Associate hints/errors with `aria-describedby`. The range should
  expose its percentage; timeout should announce seconds.
- Keep persistent visible labels after values replace placeholders. Existing
  wrapped `Field` labels and login accessible names are not blanket failures;
  preserve working associations and add visible login labels if absent.
- This is a naming/interaction change only around the AT tool. Do not modify
  its command allowlist or expand its capabilities.

**Acceptance:** accessibility tree exposes meaningful names, roles and selected
states; clicking a label focuses its input; tab keys/arrow keys follow the
chosen pattern; inactive panels cannot trap focus; keyboard navigation alone
cannot issue radio/APN/AT mutations. Test each shared primitive and at least
one integrated consumer, then inspect all call sites for correct wiring.

## U04 — Accessible feedback and toast restraint

**Code anchors:** `ui/feedback.tsx::Toaster`, error/success callers, inline
feature status from R07/R08/R10/R14.

Use a mounted live-region host with polite status for useful success feedback
and suitable alert treatment for failures. Avoid duplicate announcements from
both inline status and a toast. Keep essential errors and recovery actions
available after the current 3.5-second toast would disappear; do not rely on
a fleeting message as the only evidence of failed settings or stale data.

Retain useful feedback for async device actions whose outcome is not visible.
Remove redundant success toasts when the result is immediately obvious, such
as an SMS/profile row disappearing. Keep the irreversible deletion confirmation
and retain failure feedback. Do not remove a success notice if the UI does not
otherwise show acceptance, pending verification or completion.

**Acceptance:** a failure is announced once and remains understandable later;
consecutive messages are distinguishable; retry/dismiss controls are named and
keyboard/touch accessible; no layout shift; no repeated success toast on polls;
delete confirmations still work. Test live-region DOM changes and manually
check a screen reader; automation alone cannot establish announcement quality.

## U05 — Signal tooltips and metric help

**Code anchors:** `features/signal/Overview.tsx::Tip`, metric help strings,
desktop headers and mobile metric labels.

The current tooltip clamps a centre coordinate but applies it as the box's
left edge. The 224px box can extend roughly 104px past the right viewport edge.
Its span trigger also lacks keyboard focus support.

Use a focusable named trigger and stable description association. Show
immediately on keyboard focus and after a modest hover delay (about 300ms);
cancel that timer on leave/unmount. Provide clear tap/click toggle, Escape and outside
dismissal behaviour. A tooltip with noninteractive explanatory text must not
trap focus. Allow the pointer to move onto persistent hover content when needed.

Clamp the actual left edge (`centre - width / 2`) to viewport margins, account
for available top/bottom space, and recompute/close safely on resize/scroll.
At narrow widths, cap the box width to the available viewport. Replace
`shadow-lg` with the locked surface/border/elevation rules. Make equivalent
help available in mobile cards; repairing desktop headers alone is insufficient.

**Regression cases:** first/last metric columns near both edges; top/bottom of
viewport; keyboard focus/Escape; touch open/dismiss; scrolling/resize; long text;
200% zoom; both themes; mobile help. Assert the complete tooltip rectangle stays
within the viewport and does not obscure its trigger unnecessarily.

## U06 — Touch targets consistent with the compact design

**Code anchors:** `ui/controls.tsx`, `ui/Tabs.tsx`, Shell icon controls,
custom band/APN/USB buttons and tooltip triggers.

Current shared buttons are 32/36px high and the switch is 24×40px. Document a
shared touch hit-area rule, targeting at least **44×44 CSS pixels for coarse
pointers**, then apply it consistently. The visible switch may stay compact
inside a larger button. Avoid overlapping invisible padding between adjacent
controls; use actual measured hit areas and sufficient spacing.

Keep label text on one line and retain Cobalt's typography/radii. Do not fix
one page with arbitrary sizes while leaving shared controls inconsistent.
Ensure icon-only theme, dismiss, copy and other actions have names and targets.

**Acceptance:** browser-measured interactive bounds meet the chosen rule on
touch layouts; neighbouring band buttons remain independently tappable; keyboard
focus outlines remain visible; no new overflow at 320px. This is Hallmark's
touch recommendation. WCAG 2.2 AA's target-size minimum is 24px with exceptions;
do not report every old 32px button as an automatically proven WCAG AA failure.

## U07 — Complete stacked mobile layouts

**Code anchors:** `features/network/ClientsTab.tsx` USB/Ethernet/Other sections,
`features/signal/Locking.tsx::ServingCells`, and remaining table consumers.

Use the existing stacked-row pattern below `sm`, keeping desktop tables above
that breakpoint. Preserve hostname, IP, MAC, interface, rates, carrier role,
band, PCI, ARFCN, signal and action context. Fields unavailable on a narrow
screen must not silently disappear just because the desktop column is hidden.

Use synthetic long hostnames, IPv6 addresses, MACs, high rates, multiple
carriers, missing metrics and long warnings. Wrap/break data values deliberately
without wrapping clickable action labels. Each cell's Lock action must remain
unambiguously associated with its tuple and state. Do not rely on root
`overflow-x: clip` to conceal inaccessible content.

**Acceptance matrix:** 320, 375, 414 and 768 CSS-pixel widths plus a representative
desktop width, both themes, touch and keyboard, 200% zoom and reduced motion.
No page/table horizontal scrolling on phones, clipped values, inaccessible
actions, or bottom-navigation obstruction. Respect safe areas. Confirm data
equivalence between desktop and mobile layouts, not just appearance.

The missing mobile variants are source-confirmed. The review did not measure
every viewport above; implementation must produce that evidence rather than
claim those checks already passed.

## V01 — Integration, release evidence and device validation

### Preserve established correct behaviour

Regression coverage must retain:

- Modem WAN counters and IPA-aware throughput, bytes/second to Mbps conversion,
  reconnect/counter-reset handling and initial-sample fallback.
- Full NR cell IDs beyond 32 bits, LTE/NSA ID presentation, legitimate PCI/SINR
  zero values, and neutral unmeasured NR SCC floors.
- Shared dashboard heartbeat, source-specific stale/last-good metadata, TTLs,
  non-overlapping requests and no publication after unmount.
- Battery units and plugged-but-not-charging distinction. Do not clamp or
  “correct” unusual raw hardware estimates merely to make them look plausible;
  investigate provenance and label estimate/unavailable states if needed.
- Existing authenticated envelope handling, session-expiry flow, scoped LAN
  confirmation token behaviour, backend safety guards and reduced motion.
- Lazy feature loading, local fonts, Cobalt light/dark tokens, and the lightweight
  production dependency footprint.

### Automated checks after implementation

Run targeted tests while working, then the repository-required integrated suite
before calling the implementation complete. Record actual results and failures;
do not imply checks ran because commands are listed here.

From the project root:

```sh
cargo fmt --all --check
cargo test -p zte-agent -p process-runner --locked
cargo clippy -p zte-agent -p process-runner --all-targets --locked -- -D warnings
python3 scripts/check-api-contract.py
python3 -m unittest discover -s tests
python3 scripts/check-device-secrets.py
python3 scripts/check-release.py
```

From `web-app/`:

```sh
npm ci
npm run build
npm run lint
npm test
npm run test:browser
```

The last command is introduced by A03; it does not exist at this baseline.
Document any required development browser installation. If the selected harness
uses a different command, update this section and CI together. Review test
execution paths before running newly added tests to ensure they cannot reach
device mutation code. Do not install or execute the firmware as a test fixture.

Preserve all other applicable `.github/workflows/checks.yml` checks, including
shell syntax and release checks. If installer/shared deployment code is changed,
run the native installer build/tests/clippy on its supported CI platforms as
well; no such change is needed merely to implement dashboard remediations.
Do not introduce unrelated installer work to claim broader coverage.

### Browser/manual acceptance

1. Exercise every task's failure and success cases using the local fixture
   harness. Include combined scenarios: source stale while editing; APN
   mutation accepted with read-back failure; responsive layout with an alert
   and dialog; SMS filter switch during refresh; lock accepted but no service.
2. Traverse all five groups and their tabs by keyboard. Verify names, focus,
   dialog dismissal/restore, labels, disabled states, live-region restraint and
   help content. Check at least VoiceOver/Safari on macOS and document any
   Windows/screen-reader coverage actually performed.
3. Complete U07's viewport matrix in both themes. Verify 200% zoom, reduced
   motion, long/unavailable data and touch targets. Check horizontal content
   bounds; absence of a scrollbar is not sufficient.
4. Verify colour/label/legend agreement and record the changed thresholds in
   release notes. Users should understand why a previous orange RSRQ is now
   green without assuming the measured radio signal changed.
5. Check bundle/runtime requests: no new production state framework, duplicated
   heartbeat, unnecessary source polling, third-party fonts, or external service
   introduced by these fixes.

### Documentation to update with the implementation

- `web-app/design.md`: quality policy, focus/touch treatments, shared field,
  dialog/selection semantics and any amended mobile rule.
- `docs/DASHBOARD.md`: truthful labels, unavailable/stale states, lock semantics,
  supported USB operations and relevant interaction changes.
- `docs/AGENT.md`: only actual endpoint/request/response changes, including any
  newly normalised read-back field or documented legacy counter name.
- `ARCHITECTURE.md`: resource ownership or contract-check changes that affect
  the documented design; preserve accurate existing architecture statements.
- Test instructions/CI configuration: how to run fixture/browser suites safely.
  Release notes: intentional threshold/boundary and visible behaviour changes.

### Separately authorised device verification

Complete local code, tests and review first. The authorised live-device check
must be precise about which artefacts will be deployed and which settings may
change. Prepare reviewable evidence before requesting any missing permission.
Follow existing deploy tooling and `docs/DEPLOYMENT.md`; do not invent a shortcut.

- For deployment, use the existing transactional path and dry-run, then the
  mandated artefact/process/log/live-API verification. Obtain credentials through
  the approved user/environment path; never scrape the startup script. Use the
  pinned SSH host file and never disable host-key verification. A changed pin
  requires the owner's approval before re-pinning.
- A frontend accuracy check can use narrowly scoped, redacted read-only values:
  compare the visible primary tuple, metrics/units, usage/reset fields,
  capability states and freshness with the corresponding live agent response.
  Avoid printing full responses that include identifiers or credentials.
- A live NR-lock trial requires explicit approval for the chosen target and
  possible WAN interruption. Record the baseline network type, lock read-back,
  observed PCC tuple, CA set and connectivity. Submit one reviewed existing
  lock request; observe fresh read-back/PCC/connectivity/CA. State whether the
  request was accepted, configured and/or served. Do not label arbitrary
  SCC-to-PCC selection proven from one successful target.
- Agree the permitted restoration action before the trial. If it would require
  reset, mode change or reboot outside that approval, stop and report the state;
  do not improvise recovery. Network/firmware may prevent the target becoming
  primary even when the UI and request path work correctly.
- Live Wi-Fi/APN/USB/charge mutations are separate optional tests requiring
  corresponding authorisation and a viable management/recovery path. Mock
  coverage remains the default for cancellation, failure and destructive cases.

If hardware validation is not authorised or cannot be performed, report
“locally verified; live-device validation pending” and identify the affected
behaviour. Do not claim an end-to-end deployed fix or verified modem capability.

## Completion checklist for the implementing agent

- [ ] Rechecked baseline and applicable local instructions; preserved user edits.
- [ ] A01–A03 foundations implemented only as required and covered by tests.
- [ ] R01–R15 addressed with the specified behavioural evidence or a documented,
      evidence-backed reason that a finding no longer applies.
- [ ] U01–U07 verified in a real local browser, with remaining manual coverage
      stated explicitly.
- [ ] Relevant documentation, mock state and API contracts agree.
- [ ] Required automated checks passed; failures/limitations recorded honestly.
- [ ] No device mutation, deployment, credential exposure or unrelated safety
      change occurred outside the owner's authorisation.
- [ ] Main agent reviewed the complete diff, including shared/protected areas.
- [ ] Authorised device validation completed, or explicitly listed as pending.
- [ ] Final handoff maps each finding ID to changes, tests and remaining limits.

## Review evidence and source notes

The baseline review passed `cargo fmt --all --check`, the then-current API
contract check, dashboard lint/type checking, and the 11 existing dashboard
Node tests. It did **not** run the full Rust/Python/native installer suites,
complete mobile/browser acceptance, or any disruptive device test. Those earlier
passes do not cover future code changes. The live UI observations were desktop
read-only observations; synthetic edge cases must remain identified as such.

The external framework was the public Nutlope Hallmark skill, applied as a
read-only audit, with local Cobalt rules taking precedence. Future agents should
read the relevant guidance and record the version they use; upstream `main`
can change. Do not install a skill or rewrite the genre merely to execute this
plan.

- [Hallmark skill](https://github.com/Nutlope/hallmark/blob/main/skills/hallmark/SKILL.md)
  and [audit guidance](https://github.com/Nutlope/hallmark/blob/main/skills/hallmark/references/verbs/audit.md):
  audit framework and actionable UI findings.
- [WAI-ARIA modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)
  and [tabs pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/): focus,
  naming, keyboard and panel relationships.
- [WCAG status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html)
  and [target size minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html):
  accessible feedback and the distinction between AA minimums and Hallmark's
  stronger touch recommendation.
- [Teltonika mobile signal guidance](https://wiki.teltonika-networks.com/view/Mobile_Signal_Strength_Recommendations):
  context for practical signal heuristics, not a mandatory policy for this ZTE
  unit. The proposed SINR 10 dB boundary follows the app's intended legend;
  it is not asserted to be Teltonika's exact threshold.
- [3GPP TS 38.215 / ETSI, section 5](https://www.etsi.org/deliver/etsi_ts/138200_138299/138215/18.03.00_60/ts_138215v180300p.pdf):
  NR measurement definitions and the distinction between reference power,
  quality, SINR and wideband received power.
- [3GPP TS 38.300 / ETSI, section 7.7](https://www.etsi.org/deliver/etsi_ts/138300_138399/138300/18.08.00_60/ts_138300v180800p.pdf):
  carrier aggregation and network configuration of serving cells. It does not
  establish this firmware's cell-lock effectiveness.

The repository's `zte-script-ng.js` is a reference for known safe firmware
calls, not code to copy indiscriminately. Static extracted-firmware evidence
supports the existence of an SA cell-lock path; it is not proof of arbitrary
primary-cell control or permission to run extracted binaries.
