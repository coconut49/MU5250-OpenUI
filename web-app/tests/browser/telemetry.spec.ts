import type { Locator, Page } from '@playwright/test'
import { test, expect, type MockAgent } from './support/harness'
import { openApp, VIEWPORTS } from './support/app'
import * as fx from './support/fixtures'

/**
 * Signal ratings, serving-cell readout, carrier counts, usage counters and metric help
 * (PLAN2 R01, R04/R05 Home part, R06, U05, U06/U07 for these two pages).
 * All payloads are synthetic and served by the interception harness.
 */

const metric = (page: Page, name: string): Locator => page.locator(`[data-metric="${name}"]:visible`)

function dashboard(agent: MockAgent, opts: fx.DashboardOptions = {}) {
  agent.on('GET', '/api/dashboard', { data: fx.dashboard(opts) })
}

/** The plan's example reading on an LTE link: RSRP -54, RSRQ -13, SINR 7.5, RSSI -49. */
const PLAN_EXAMPLE = { lte_rsrp: -54, lte_rsrq: -13, lte_snr: 7.5, lte_rssi: -49 }

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
}

test.describe('Home serving readout (R06, R01)', () => {
  test('SA with populated LTE fields shows the NR primary, RSRQ -11 rated Good/green', async ({ page, agent }) => {
    dashboard(agent, { network: 'SA' })
    await openApp(page)
    await expect(page.getByTestId('home-rsrp')).toHaveText('-53')
    await expect(page.getByTestId('home-rsrp')).toHaveAttribute('data-level', 'excellent')
    await expect(page.getByTestId('home-rsrp-word')).toHaveText('Excellent')
    // RAT label and band; the LTE zero PCI / LTE values are not the primary.
    await expect(page.getByText('5G SA · n78')).toBeVisible()
    await expect(page.getByText('PCI 745')).toBeVisible()
    const rsrq = metric(page, 'rsrq')
    await expect(rsrq).toHaveAttribute('data-level', 'good')
    await expect(rsrq).toHaveAttribute('data-tone', 'ok')
    await expect(rsrq).toHaveClass(/text-ok/)
    await expect(rsrq).toContainText('-11')
    await expect(rsrq).toContainText('Good')
    // Raw values are unchanged: NR SINR 31, not the LTE 21 / -48 / -7.
    await expect(metric(page, 'sinr')).toContainText('31')
    await expect(metric(page, 'sinr')).toHaveAttribute('data-level', 'excellent')
    await expect(page.locator('main')).not.toContainText('-48')
    await expect(page.getByText('5/5 bars')).toBeVisible()
  })

  test('NSA is labelled as the LTE anchor', async ({ page, agent }) => {
    dashboard(agent, { network: 'NSA' })
    await openApp(page)
    await expect(page.getByText('LTE anchor (NSA) · B8')).toBeVisible()
    await expect(page.getByTestId('home-rsrp')).toHaveText('-71')
  })

  test('plan example renders ok / ok / warn / neutral with words', async ({ page, agent }) => {
    dashboard(agent, { network: 'LTE', signal: PLAN_EXAMPLE })
    await openApp(page)
    await expect(page.getByTestId('home-rsrp')).toHaveText('-54')
    await expect(page.getByTestId('home-rsrp')).toHaveClass(/text-ok/)
    await expect(page.getByTestId('home-rsrp-word')).toHaveText('Excellent')
    await expect(metric(page, 'rsrq')).toHaveClass(/text-ok/)
    await expect(metric(page, 'rsrq')).toContainText('Good')
    await expect(metric(page, 'sinr')).toHaveClass(/text-warn/)
    await expect(metric(page, 'sinr')).toContainText('Fair')
    await expect(metric(page, 'sinr')).toContainText('7.5')
    await expect(metric(page, 'rssi')).toHaveClass(/text-ink2/)
    await expect(metric(page, 'rssi')).toContainText('-49')
    await expect(metric(page, 'rssi')).toHaveAttribute('data-tone', 'neutral')
  })

  test('PCI 0 on the serving cell is shown', async ({ page, agent }) => {
    dashboard(agent, { network: 'LTE', signal: { lte_pci: 0 } })
    await openApp(page)
    await expect(page.getByText('PCI 0', { exact: true })).toBeVisible()
  })

  test('disconnected all-zero payload: no serving cell, never Excellent, bars unknown', async ({ page, agent }) => {
    dashboard(agent, {
      network: 'disconnected',
      signal: { signalbar: null, lte_rsrp: 0, lte_rsrq: 0, lte_snr: 0, lte_rssi: 0, nr5g_rsrp: 0, nr5g_rsrq: 0, nr5g_snr: 0 },
    })
    await openApp(page)
    await expect(page.getByTestId('home-rsrp-word')).toHaveText('No serving measurement')
    await expect(page.getByTestId('home-rsrp')).toHaveAttribute('data-level', 'unknown')
    await expect(page.getByTestId('home-rsrp')).toHaveClass(/text-ink3/)
    await expect(page.getByText('Bars unavailable', { exact: true })).toBeVisible()
    const main = page.locator('main')
    await expect(main).not.toContainText('Excellent')
    await expect(main).not.toContainText('0/5')
    for (const m of ['rsrq', 'sinr', 'rssi']) await expect(metric(page, m)).toHaveAttribute('data-level', 'unknown')
  })

  test('a genuine 0-bar reading is shown as 0/5, distinct from unknown', async ({ page, agent }) => {
    dashboard(agent, { network: 'disconnected', signal: { signalbar: '0' } })
    await openApp(page)
    await expect(page.getByText('0/5 bars')).toBeVisible()
    await expect(page.getByTestId('home-rsrp-word')).toHaveText('No serving measurement')
  })

  test('carriers are "reported" with active/idle counts; idle SCCs stay neutral', async ({ page, agent }) => {
    dashboard(agent, { network: 'NSA' })
    await openApp(page)
    await expect(page.getByRole('heading', { name: 'Reported carriers' })).toBeVisible()
    await expect(page.getByText(/\d+ carriers? reported/)).toBeVisible()
    await expect(page.getByText(/\d+ active · 1 idle/)).toBeVisible()
    await expect(page.getByText('Sum of reported carriers')).toBeVisible()
    await expect(page.getByText('SCC1 · n78 · idle')).toBeVisible()
  })
})

test.describe('Home usage (R04/R05)', () => {
  test('unknown counters render as unavailable, never 0 B or NaN; measured zero stays 0 B', async ({ page, agent }) => {
    const unknown = { rx_bytes: null, tx_bytes: null, time_secs: null }
    dashboard(agent, {
      data_usage: {
        day: unknown,
        month: unknown,
        cycle: { rx_bytes: null, tx_bytes: 5, time_secs: null },
        total: { rx_bytes: 0, tx_bytes: 0, time_secs: 0 },
      },
    })
    await openApp(page)
    const today = page.locator('[data-usage="Today"]')
    await expect(today).toContainText('Unavailable')
    await expect(today).not.toContainText('0 B')
    await expect(today).not.toContainText('NaN')
    const cycle = page.locator('[data-usage="Current cycle"]')
    await expect(cycle).toContainText('5 B')
    // One direction known: the component stays, the total is unknown (not 5 B).
    await expect(cycle.locator('span.text-ink2')).toContainText('Unavailable')
    const total = page.locator('[data-usage="Total"]')
    await expect(total).toContainText('0 B')
    await expect(total).not.toContainText('Unavailable')
    await expect(page.locator('main')).not.toContainText('NaN')
  })

  test('the monthly counters are labelled "Current cycle", not "This month"', async ({ page, agent }) => {
    dashboard(agent)
    await openApp(page)
    await expect(page.locator('[data-usage="Current cycle"]')).toBeVisible()
    await expect(page.getByText('This month')).toHaveCount(0)
    // Totals come from usageTotal: 64.8 GB + 3.9 GB.
    await expect(page.locator('[data-usage="Current cycle"]')).toContainText('68.7 GB')
  })
})

test.describe('Signal overview ratings and legend (R01)', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`plan example in the desktop table, ${theme} theme`, async ({ page, agent }) => {
      dashboard(agent, { network: 'LTE', signal: PLAN_EXAMPLE })
      await page.setViewportSize(VIEWPORTS.desktop)
      await openApp(page, { group: 'signal', theme })
      const row = page.locator('table:visible tbody tr').first()
      await expect(row.locator('[data-metric="rsrp"]')).toHaveClass(/text-ok/)
      await expect(row.locator('[data-metric="rsrp"]')).toContainText('Excellent')
      await expect(row.locator('[data-metric="rsrq"]')).toHaveClass(/text-ok/)
      await expect(row.locator('[data-metric="rsrq"]')).toContainText('Good')
      await expect(row.locator('[data-metric="sinr"]')).toHaveClass(/text-warn/)
      await expect(row.locator('[data-metric="sinr"]')).toContainText('Fair')
      await expect(row.locator('[data-metric="rssi"]')).toHaveClass(/text-ink2/)
      await expect(row.locator('[data-metric="rssi"]')).toHaveText('-49')
      // Colours resolve to real, distinct theme values (not transparent / identical).
      const colours = await row.evaluate((r) => {
        const c = (m: string) => getComputedStyle(r.querySelector(`[data-metric="${m}"]`)!).color
        return { ok: c('rsrp'), warn: c('sinr'), neutral: c('rssi') }
      })
      expect(new Set(Object.values(colours)).size).toBe(3)
    })

    test(`plan example in the mobile cards, ${theme} theme`, async ({ page, agent }) => {
      dashboard(agent, { network: 'LTE', signal: PLAN_EXAMPLE })
      await page.setViewportSize(VIEWPORTS.phone375)
      await openApp(page, { group: 'signal', theme })
      const card = page.locator('div.sm\\:hidden > div').first()
      await expect(card.locator('[data-metric="rsrp"]')).toHaveClass(/text-ok/)
      await expect(card.locator('[data-metric="rsrq"]')).toContainText('Good')
      await expect(card.locator('[data-metric="sinr"]')).toHaveClass(/text-warn/)
      await expect(card.locator('[data-metric="sinr"]')).toContainText('7.5')
      await expect(card.locator('[data-metric="rssi"]')).toHaveClass(/text-ink2/)
      await expectNoHorizontalOverflow(page)
    })
  }

  test('idle / unmeasured SCCs are neutral and Unavailable on both layouts', async ({ page, agent }) => {
    dashboard(agent, { network: 'NSA' })
    await page.setViewportSize(VIEWPORTS.desktop)
    await openApp(page, { group: 'signal' })
    // The NSA fixture's second NR SCC (PCI 56) is configured but unmeasured: reporting floors, Idle.
    const idleRow = page.locator('table:visible tbody tr', { hasText: 'Idle' })
    for (const m of ['rsrp', 'rsrq', 'sinr', 'rssi']) {
      await expect(idleRow.locator(`[data-metric="${m}"]`)).toHaveAttribute('data-level', 'unknown')
      await expect(idleRow.locator(`[data-metric="${m}"]`)).toHaveClass(/text-ink3/)
    }
    await expect(idleRow).toContainText('Idle')
    // The measured NR SCC next to it is rated.
    const measured = page.locator('table:visible tbody tr', { hasText: 'n40' })
    await expect(measured.locator('[data-metric="rsrp"]')).toHaveAttribute('data-level', 'good')

    await page.setViewportSize(VIEWPORTS.phone375)
    const idleCard = page.locator('div.sm\\:hidden > div', { hasText: 'Idle' })
    await expect(idleCard.locator('[data-metric="rsrp"]')).toHaveAttribute('data-level', 'unknown')
  })

  test('summary card separates reported carriers from active ones and says what bandwidth sums', async ({ page, agent }) => {
    dashboard(agent, { network: 'NSA' })
    await page.setViewportSize(VIEWPORTS.desktop)
    await openApp(page, { group: 'signal' })
    await expect(page.getByText('Carriers reported')).toBeVisible()
    await expect(page.getByText(/NR active, 1 idle/)).toBeVisible()
    await expect(page.getByText('Reported bandwidth')).toBeVisible()
    await expect(page.getByText('Sum of all reported carriers')).toBeVisible()
    await expect(page.getByText(/Active only/)).toBeVisible()
    await expect(page.getByTestId('serving-cell')).toHaveText('LTE anchor (NSA) · B8')
  })

  test('summary shows no serving cell and unknown bars when disconnected', async ({ page, agent }) => {
    dashboard(agent, { network: 'disconnected', signal: { signalbar: null } })
    await openApp(page, { group: 'signal' })
    await expect(page.getByTestId('serving-cell')).toContainText('No serving carrier reported')
    await expect(page.getByText('Bars', { exact: false }).first()).toBeVisible()
  })

  test('legend rows are generated from the policy and carry the approximation note', async ({ page, agent }) => {
    dashboard(agent)
    await openApp(page, { group: 'signal' })
    await expect(page.getByRole('heading', { name: 'Signal quality reference' })).toBeVisible()
    const rows = async (m: string) =>
      page.locator(`[data-legend="${m}"] li`).evaluateAll((els) => els.map((e) => [...e.children].map((c) => c.textContent)))
    expect(await rows('sinr')).toEqual([
      ['Excellent', '≥ 20'],
      ['Good', '10 to 20'],
      ['Fair', '0 to 10'],
      ['Poor', '< 0'],
    ])
    expect(await rows('rsrp')).toEqual([
      ['Excellent', '≥ −80'],
      ['Good', '−90 to −80'],
      ['Fair', '−100 to −90'],
      ['Poor', '< −100'],
    ])
    expect(await rows('rsrq')).toEqual([
      ['Excellent', '≥ −10'],
      ['Good', '−15 to −10'],
      ['Fair', '−20 to −15'],
      ['Poor', '< −20'],
    ])
    await expect(page.getByText(/approximate link indicators/)).toBeVisible()
    // Legend colours follow the same tone mapping as the values.
    await expect(page.locator('[data-legend="sinr"] li[data-level="good"] span').first()).toHaveClass(/text-ok/)
    await expect(page.locator('[data-legend="sinr"] li[data-level="fair"] span').first()).toHaveClass(/text-warn/)
    await expect(page.locator('[data-legend="sinr"] li[data-level="poor"] span').first()).toHaveClass(/text-danger/)
  })

  test('no horizontal overflow at 320 px on Home and Signal with long values', async ({ page, agent }) => {
    dashboard(agent, { network: 'NSA' })
    await page.setViewportSize(VIEWPORTS.phone320)
    await openApp(page)
    await expect(page.getByTestId('home-rsrp')).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await page.getByRole('navigation').getByRole('button', { name: 'Signal', exact: true }).click()
    await expect(page.locator('div.sm\\:hidden > div').first()).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })
})

test.describe('Metric help tooltip (U05)', () => {
  const inViewport = async (page: Page, box: { x: number; y: number; width: number; height: number } | null) => {
    expect(box).not.toBeNull()
    const vp = page.viewportSize()!
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(vp.width)
    expect(box!.y + box!.height).toBeLessThanOrEqual(vp.height)
  }
  const disjoint = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
    a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y

  for (const [name, viewport] of [
    ['375 px', VIEWPORTS.phone375],
    ['desktop', VIEWPORTS.desktop],
  ] as const) {
    for (const edge of ['RSRP', 'RSSI']) {
      test(`first/last metric (${edge}) opens on focus inside the viewport at ${name}, Escape closes`, async ({ page, agent }) => {
        dashboard(agent, { network: 'NSA' })
        await page.setViewportSize(viewport)
        await openApp(page, { group: 'signal' })
        const trigger = page.getByRole('button', { name: edge, exact: true }).first()
        await trigger.scrollIntoViewIfNeeded()
        await trigger.focus()
        const tip = page.getByRole('tooltip')
        await expect(tip).toBeVisible()
        await expect(tip).toContainText(edge === 'RSRP' ? 'Reference Signal Received Power' : 'Received Signal Strength Indicator')
        // Visible box is placed (not left at its hidden origin) and fully inside the viewport.
        await expect(tip).toHaveCSS('visibility', 'visible')
        const box = await tip.boundingBox()
        await inViewport(page, box)
        const tbox = (await trigger.boundingBox())!
        expect(disjoint(box!, tbox)).toBe(true)
        // Stable description association.
        const described = await trigger.evaluate((el) => document.getElementById(el.getAttribute('aria-describedby')!)?.textContent)
        expect(described).toContain(edge === 'RSRP' ? 'Reference Signal' : 'Received Signal Strength')
        await page.keyboard.press('Escape')
        await expect(tip).toHaveCount(0)
        await expect(trigger).toBeFocused()
      })
    }
  }

  test('hover opens after a delay, leaving closes it; click pins and toggles; outside click dismisses', async ({ page, agent }) => {
    dashboard(agent, { network: 'LTE' })
    await page.setViewportSize(VIEWPORTS.desktop)
    await openApp(page, { group: 'signal' })
    const trigger = page.getByRole('button', { name: 'SINR', exact: true }).first()
    const tip = page.getByRole('tooltip')
    await trigger.hover()
    await expect(tip).toBeVisible() // after ~300 ms
    await page.mouse.move(5, 5)
    await expect(tip).toHaveCount(0)
    // A click pins it even while the pointer stays over the trigger; a second click closes.
    await trigger.click()
    await expect(tip).toBeVisible()
    await page.mouse.move(5, 5)
    await page.waitForTimeout(400)
    await expect(tip).toBeVisible()
    await trigger.click()
    await expect(tip).toHaveCount(0)
    // Outside press dismisses.
    await trigger.click()
    await expect(tip).toBeVisible()
    await page.mouse.click(5, 400)
    await expect(tip).toHaveCount(0)
  })

  test('does not open on a quick hover pass (timer is cancelled on leave)', async ({ page, agent }) => {
    dashboard(agent, { network: 'LTE' })
    await page.setViewportSize(VIEWPORTS.desktop)
    await openApp(page, { group: 'signal' })
    const trigger = page.getByRole('button', { name: 'RSRQ', exact: true }).first()
    await trigger.hover()
    await page.mouse.move(5, 5)
    await page.waitForTimeout(500)
    await expect(page.getByRole('tooltip')).toHaveCount(0)
  })

  test.describe('touch', () => {
    test.use({ hasTouch: true, viewport: VIEWPORTS.phone375 })

    test('tap toggles the card help, triggers meet the 44 px target and stay inside the viewport', async ({ page, agent }) => {
      dashboard(agent, { network: 'NSA' })
      await openApp(page, { group: 'signal' })
      const trigger = page.getByRole('button', { name: 'SINR', exact: true }).first()
      await trigger.scrollIntoViewIfNeeded()
      const box = (await trigger.boundingBox())!
      expect(box.width).toBeGreaterThanOrEqual(43.5)
      expect(box.height).toBeGreaterThanOrEqual(43.5)
      const tip = page.getByRole('tooltip')
      await trigger.tap()
      await expect(tip).toBeVisible()
      await inViewport(page, await tip.boundingBox())
      await trigger.tap()
      await expect(tip).toHaveCount(0)
      await trigger.tap()
      await expect(tip).toBeVisible()
      await page.touchscreen.tap(2, 2)
      await expect(tip).toHaveCount(0)
    })
  })

  test('closes on scroll and re-places on resize', async ({ page, agent }) => {
    dashboard(agent, { network: 'NSA' })
    await page.setViewportSize(VIEWPORTS.phone375)
    await openApp(page, { group: 'signal' })
    const trigger = page.getByRole('button', { name: 'RSRP', exact: true }).first()
    await trigger.focus()
    const tip = page.getByRole('tooltip')
    await expect(tip).toBeVisible()
    await page.setViewportSize(VIEWPORTS.phone320)
    await expect.poll(async () => (await tip.boundingBox())?.x ?? -1).toBeGreaterThanOrEqual(0)
    await inViewport(page, await tip.boundingBox())
    await page.mouse.wheel(0, 200)
    await expect(tip).toHaveCount(0)
  })

  test('tooltip uses the design surface and border, not a drop shadow', async ({ page, agent }) => {
    dashboard(agent)
    await openApp(page, { group: 'signal' })
    await page.getByRole('button', { name: 'RSRQ', exact: true }).first().focus()
    await expect(page.getByRole('tooltip')).toHaveCSS('box-shadow', 'none')
  })
})
