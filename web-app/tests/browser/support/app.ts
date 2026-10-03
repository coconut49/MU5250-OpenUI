import type { Page } from '@playwright/test'
import type { MockAgent } from './harness'

export type Group = 'home' | 'signal' | 'network' | 'modem' | 'system'

export const GROUP_LABEL: Record<Group, string> = {
  home: 'Home',
  signal: 'Signal',
  network: 'Network',
  modem: 'Modem',
  system: 'System',
}

/** Viewport presets. `desktop` is above the `lg` (1024px) breakpoint where the sidebar replaces the bottom tabs. */
export const VIEWPORTS = {
  phone320: { width: 320, height: 568 },
  phone375: { width: 375, height: 812 },
  phone414: { width: 414, height: 896 },
  tablet768: { width: 768, height: 1024 },
  desktop: { width: 1280, height: 800 },
} as const

/** Fixed fake wall-clock used by `installClock` (a Monday, local-time label in UTC like the device). */
export const CLOCK_START = new Date('2026-10-05T12:00:00.000Z')

export interface OpenAppOptions {
  group?: Group
  /** Visible tab label inside the group, e.g. 'Mode & Locking'. */
  tab?: string
  /** Persisted via localStorage `u60.theme` before the app boots (and mirrored in prefers-color-scheme). Default 'light'. */
  theme?: 'light' | 'dark'
  /** Emulate `prefers-reduced-motion: reduce`. Default false. */
  reducedMotion?: boolean
  /** Install the fake clock (see `installClock`) before navigation; it keeps flowing until `freezeClock`. Default false. */
  clock?: boolean
}

/**
 * Controlled time. Playwright's `page.clock` replaces setTimeout/setInterval/
 * Date/rAF. The app's heartbeat is a PollScheduler `setTimeout` chain (3 s on
 * Home and Signal, 15 s elsewhere) that re-arms only after each response:
 *
 *   await openApp(page, { clock: true })          // fake clock installed, still flowing
 *   await expect(page.getByText('78').first()).toBeVisible()
 *   await freezeClock(page)                        // no timer fires from here on
 *   await advanceHeartbeat(page, agent)            // exactly one more /api/dashboard
 *
 * Gotchas:
 *  - Install BEFORE navigation (openApp's `clock: true` does). Freeze AFTER the
 *    first render: React delays revealing lazily loaded content by up to 300 ms
 *    with a setTimeout, so on a frozen clock a freshly selected group stays
 *    blank until time moves. After clicking a group/tab while frozen, call
 *    `settleRender(page)`.
 *  - Responses still arrive in real time. Wait for them with the request log
 *    (advanceHeartbeat does) or `expect.poll`, never with sleeps.
 *  - The 15 s request timeout is a timer too; a frozen clock never times out.
 */
export async function installClock(page: Page, time: Date | number = CLOCK_START): Promise<void> {
  await page.clock.install({ time })
}

/** Stop the fake clock where it is. Timers fire only via `page.clock.runFor`/`advanceHeartbeat`. */
export async function freezeClock(page: Page): Promise<void> {
  // pauseAt must target the future; the fake clock keeps flowing between our read
  // and the call, so retry with a growing margin (all far below any poll interval).
  for (let margin = 100; ; margin *= 4) {
    const now = await page.evaluate(() => Date.now())
    try {
      await page.clock.pauseAt(new Date(now + margin))
      return
    } catch (error) {
      if (margin > 1600 || !String(error).includes('past')) throw error
    }
  }
}

/** Let React flush timer-gated work (Suspense reveal throttle) on a frozen clock. Far below any poll interval. */
export async function settleRender(page: Page, ms = 350): Promise<void> {
  await page.clock.runFor(ms)
}

/**
 * Advance the fake clock by `ms` (default 3000, the Home/Signal interval; use
 * 15000 for other groups) and wait until `path` has been requested at least
 * once more. Returns the new total request count for that path.
 */
export async function advanceHeartbeat(
  page: Page,
  agent: MockAgent,
  ms = 3000,
  path = '/api/dashboard',
): Promise<number> {
  const before = agent.requests({ method: 'GET', path }).length
  await page.clock.runFor(ms)
  await pollUntil(() => agent.requests({ method: 'GET', path }).length > before)
  return agent.requests({ method: 'GET', path }).length
}

async function pollUntil(cond: () => boolean, timeoutMs = 5000) {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for the next request')
    await new Promise((r) => setTimeout(r, 20))
  }
}

/**
 * Boot the app authenticated (the harness seeds a fake token) and optionally
 * navigate to a group/tab. The app has no URL routing: groups and tabs are
 * React state, so this clicks the real navigation. Resolves once the target
 * group's heading/tab is visible; it does not wait for data.
 */
export async function openApp(page: Page, opts: OpenAppOptions = {}): Promise<void> {
  const theme = opts.theme ?? 'light'
  await page.emulateMedia({ colorScheme: theme, reducedMotion: opts.reducedMotion ? 'reduce' : 'no-preference' })
  // Seed once per tab so a test that flips the theme in the UI survives a reload.
  await page.addInitScript((t) => {
    try {
      if (!sessionStorage.getItem('__pw_theme_seeded')) {
        localStorage.setItem('u60.theme', t)
        sessionStorage.setItem('__pw_theme_seeded', '1')
      }
    } catch {
      /* storage unavailable */
    }
  }, theme)
  if (opts.clock) await installClock(page)

  await page.goto('/')
  const group = opts.group ?? 'home'
  const nav = page.getByRole('navigation')
  const groupButton = nav.getByRole('button', { name: GROUP_LABEL[group], exact: true })
  await groupButton.waitFor({ state: 'visible' })
  if (group !== 'home') await groupButton.click()
  if (opts.tab) {
    const exact = page.getByRole('tab', { name: opts.tab, exact: true })
    const tab = (await exact.count()) > 0 ? exact : page.getByRole('tab', { name: opts.tab })
    await tab.click()
  }
}
