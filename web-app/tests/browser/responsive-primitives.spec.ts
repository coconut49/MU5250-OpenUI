import type { Page } from '@playwright/test'
import { test, expect } from './support/harness'
import { openApp, VIEWPORTS, type Group } from './support/app'

/** Shared-primitive layout rules: ≥44×44 hit areas on touch, and no sideways scroll at 320 px. */

const MIN_HIT = 44
const box = async (page: Page, selector: string) =>
  page.locator(selector).evaluateAll((els) =>
    els.flatMap((e) => {
      const r = e.getBoundingClientRect()
      if (r.width === 0 && r.height === 0) return [] // display:none (e.g. the desktop sidebar on a phone)
      return [{ w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, name: e.textContent?.trim() || e.getAttribute('aria-label') || e.tagName }]
    }),
  )

test.describe('touch hit areas (375 px, coarse pointer)', () => {
  test.use({ viewport: VIEWPORTS.phone375, hasTouch: true, isMobile: true })

  test('the context reports a coarse pointer', async ({ page }) => {
    await openApp(page)
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true)
  })

  test('buttons, switches, segmented items, tabs and nav controls are at least 44 x 44', async ({ page, agent }) => {
    agent.on('POST', '/api/device/reboot', { data: {} })
    await openApp(page, { group: 'system', tab: 'Settings' })
    await expect(page.getByRole('button', { name: 'Reboot', exact: true })).toBeVisible()
    await expect(page.getByRole('radio').first()).toBeVisible()

    // Shared `Button`s on this page. Feature-specific custom buttons are reported below, not asserted.
    for (const name of ['Reboot', 'Shut down', 'Restart agent', 'Sign out']) {
      const b = await page.getByRole('button', { name }).first().boundingBox()
      expect(b, `${name} button`).not.toBeNull()
      expect(b!.width, `${name} width`).toBeGreaterThanOrEqual(MIN_HIT)
      expect(b!.height, `${name} height`).toBeGreaterThanOrEqual(MIN_HIT)
    }
    const small = (await box(page, 'main button:not([role])')).filter((b) => b.w < MIN_HIT || b.h < MIN_HIT)
    if (small.length) test.info().annotations.push({ type: 'undersized custom buttons', description: JSON.stringify(small) })

    const groups: Record<string, string> = {
      switches: '[role="switch"]',
      segmented: '[role="radio"]',
      tabs: '[role="tab"]',
      nav: 'nav[aria-label="Main"] button',
      theme: 'header button[aria-label="Toggle theme"]',
    }
    for (const [what, sel] of Object.entries(groups)) {
      const boxes = await box(page, sel)
      expect(boxes.length, `${what}: expected at least one`).toBeGreaterThan(0)
      for (const b of boxes) {
        expect(b.w, `${what} "${b.name}" width`).toBeGreaterThanOrEqual(MIN_HIT)
        expect(b.h, `${what} "${b.name}" height`).toBeGreaterThanOrEqual(MIN_HIT)
      }
    }
  })

  test('the switch keeps its compact 24 x 40 track inside the larger hit area', async ({ page }) => {
    await openApp(page, { group: 'system', tab: 'Settings' })
    const sw = page.getByRole('switch').first()
    await expect(sw).toBeVisible()
    const track = await sw.evaluate((b) => {
      const r = b.firstElementChild!.getBoundingClientRect()
      return { w: r.width, h: r.height }
    })
    expect(track).toEqual({ w: 40, h: 24 })
  })

  test('toast dismiss has a 44 x 44 target', async ({ page, agent }) => {
    agent.on('POST', '/api/device/reboot', { error: 'synthetic failure', status: 500 })
    await openApp(page, { group: 'system', tab: 'Settings' })
    await page.getByRole('button', { name: 'Reboot', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Reboot' }).click()
    const dismiss = page.getByRole('button', { name: 'Dismiss notification' })
    await expect(dismiss).toBeVisible()
    const b = await dismiss.boundingBox()
    expect(b!.width).toBeGreaterThanOrEqual(MIN_HIT)
    expect(b!.height).toBeGreaterThanOrEqual(MIN_HIT)
  })

  test('confirm dialog buttons meet the target size and fit the viewport', async ({ page, agent }) => {
    agent.on('POST', '/api/device/reboot', { data: {} })
    await openApp(page, { group: 'system', tab: 'Settings' })
    await page.getByRole('button', { name: 'Reboot', exact: true }).click()
    const dialog = page.getByRole('dialog')
    for (const name of ['Cancel', 'Reboot']) {
      const b = await dialog.getByRole('button', { name }).boundingBox()
      expect(b!.width).toBeGreaterThanOrEqual(MIN_HIT)
      expect(b!.height).toBeGreaterThanOrEqual(MIN_HIT)
      expect(b!.x).toBeGreaterThanOrEqual(0)
      expect(b!.x + b!.width).toBeLessThanOrEqual(VIEWPORTS.phone375.width)
    }
  })
})

test.describe('fine pointer keeps the compact sizes', () => {
  test.use({ viewport: VIEWPORTS.desktop })

  test('switch 24 x 40, medium button 36 px high', async ({ page, agent }) => {
    agent.on('POST', '/api/device/reboot', { data: {} })
    await openApp(page, { group: 'system', tab: 'Settings' })
    const sw = await page.getByRole('switch').first().boundingBox()
    expect(sw).toMatchObject({ width: 40, height: 24 })
    const btn = await page.getByRole('button', { name: 'Reboot', exact: true }).boundingBox()
    expect(btn!.height).toBe(36)
  })
})

test.describe('no horizontal overflow at 320 px', () => {
  test.use({ viewport: VIEWPORTS.phone320, hasTouch: true, isMobile: true })

  const GROUPS: Group[] = ['home', 'signal', 'network', 'modem', 'system']
  for (const group of GROUPS) {
    test(group, async ({ page }) => {
      await openApp(page, { group })
      // Let the first data render so real content is what gets measured.
      await page.waitForLoadState('networkidle')
      const over = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth
        const main = document.querySelector('main')!
        const out: string[] = []
        if (main.scrollWidth > main.clientWidth + 1) out.push(`main scrollWidth ${main.scrollWidth} > ${main.clientWidth}`)
        const scrollers = (el: Element) => {
          for (let p: Element | null = el.parentElement; p && p !== main; p = p.parentElement) {
            const ox = getComputedStyle(p).overflowX
            if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return true
          }
          return false
        }
        for (const el of document.querySelectorAll('body *')) {
          const r = el.getBoundingClientRect()
          if (r.width === 0 || r.height === 0) continue
          if (r.right > vw + 1 && !scrollers(el)) {
            out.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} right=${Math.round(r.right)}`)
            if (out.length > 8) break
          }
        }
        return out
      })
      expect(over, `${group} overflows at 320 px`).toEqual([])
    })
  }
})
