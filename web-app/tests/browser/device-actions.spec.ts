import type { Page } from '@playwright/test'
import { test, expect, type MockAgent } from './support/harness'
import { freezeClock, openApp, VIEWPORTS } from './support/app'
import * as fx from './support/fixtures'

/**
 * R10/R11/U03 on System → Settings (USB) and System → Tools (AT console).
 * Every mutation is intercepted by the synthetic agent; nothing here touches a device or a real
 * USB composition. "Applied" below only ever means the mock answered.
 */

const NCM_SCHEDULED = {
  status: 'scheduled',
  mode: 'ncm',
  experimental: true,
  delay_ms: 1000,
  rollback: 'reboot or switch back to ECM after reconnecting',
}

const usbMutations = (agent: MockAgent) => agent.mutations().filter((r) => r.path === '/api/usb/mode')
const statusReads = (agent: MockAgent) => agent.requests({ method: 'GET', path: '/api/usb/status' }).length

async function openUsb(page: Page, opts: { clock?: boolean } = {}) {
  await openApp(page, { group: 'system', tab: 'Settings', clock: opts.clock })
  await expect(page.getByText('Active mode', { exact: true })).toBeVisible()
}

/** Select NCM as a draft and press Apply: opens the confirmation. */
async function reviewNcm(page: Page) {
  await page.getByRole('radio', { name: 'NCM' }).click()
  await page.getByRole('button', { name: 'Apply mode' }).click()
  const dialog = page.getByRole('dialog', { name: 'Switch USB to NCM?' })
  await expect(dialog).toBeVisible()
  return dialog
}

/** Advance the frozen clock one recheck interval and wait until another status read has happened. */
async function recheck(page: Page, agent: MockAgent, ms = 3000) {
  const before = statusReads(agent)
  await page.clock.runFor(ms)
  await expect.poll(() => statusReads(agent)).toBeGreaterThan(before)
}

test.describe('USB mode: what is offered', () => {
  test('offers RNDIS, ECM and NCM only: there is no Debug / ADB control and no way to send mode debug', async ({ page, agent }) => {
    // A hostile or older agent that still lists debug must not make it appear.
    agent.on('GET', '/api/usb/status', {
      data: fx.usbStatus({
        supported_modes: ['rndis', 'ecm', 'ncm', 'debug'],
        mode_capabilities: [
          { mode: 'rndis', supported: true, experimental: false },
          { mode: 'ecm', supported: true, experimental: false },
          { mode: 'ncm', supported: true, experimental: true },
          { mode: 'debug', supported: true, experimental: false },
        ],
      }),
    })
    await openUsb(page)
    const radios = page.getByRole('radiogroup', { name: 'USB mode' }).getByRole('radio')
    await expect(radios).toHaveText(['RNDIS', 'ECM', 'NCM'])
    await expect(page.getByText(/debug|adb/i)).toHaveCount(0)
    await expect(page.getByRole('button', { name: /debug|adb/i })).toHaveCount(0)
    expect(agent.mutations()).toEqual([])
  })

  test('NCM unsupported by capability is disabled with an explanation, even if supported_modes lists it', async ({ page, agent }) => {
    agent.on('GET', '/api/usb/status', {
      data: fx.usbStatus({
        supported_modes: ['rndis', 'ecm', 'ncm'],
        mode_capabilities: [
          { mode: 'rndis', supported: true, experimental: false },
          { mode: 'ecm', supported: true, experimental: false },
          { mode: 'ncm', supported: false, experimental: true },
        ],
      }),
    })
    await openUsb(page)
    await expect(page.getByRole('radio', { name: 'NCM' })).toBeDisabled()
    await expect(page.getByText('NCM is not available on this firmware')).toBeVisible()
    await expect(page.getByRole('switch', { name: 'NCM after boot' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Apply mode' })).toBeDisabled()
    expect(agent.mutations()).toEqual([])
  })

  test('without a capability list the supported_modes fallback decides', async ({ page, agent }) => {
    agent.on('GET', '/api/usb/status', {
      data: { ...fx.usbStatus({ supported_modes: ['rndis', 'ecm'] }), mode_capabilities: undefined },
    })
    await openUsb(page)
    await expect(page.getByRole('radio', { name: 'ECM' })).toBeEnabled()
    await expect(page.getByRole('radio', { name: 'RNDIS' })).toBeEnabled()
    await expect(page.getByRole('radio', { name: 'NCM' })).toBeDisabled()
  })

  test('a failed status read is explicit, offers no controls, and Retry recovers', async ({ page, agent }) => {
    agent.fail('GET', '/api/usb/status', { status: 503, error: 'synthetic ubus failure' })
    await openApp(page, { group: 'system', tab: 'Settings' })
    const alert = page.getByRole('alert').filter({ hasText: 'USB status is unavailable' })
    await expect(alert).toBeVisible()
    await expect(alert).toContainText('synthetic ubus failure')
    await expect(page.getByRole('radiogroup', { name: 'USB mode' })).toHaveCount(0)
    await expect(page.getByRole('radio', { name: 'NCM' })).toHaveCount(0)

    agent.on('GET', '/api/usb/status', { data: fx.usbStatus() })
    await alert.getByRole('button', { name: 'Retry' }).click()
    await expect(page.getByText('Active mode', { exact: true })).toBeVisible()
    await expect(page.getByRole('radio', { name: 'ECM' })).toBeChecked()
    expect(agent.mutations()).toEqual([])
  })

  test('active, scheduled and boot default are three separate readouts', async ({ page, agent }) => {
    agent.on('GET', '/api/usb/status', { data: fx.usbStatus({ active_mode: 'ecm', default_mode: 'ncm', ncm_persist_on_boot: true }) })
    await openUsb(page)
    const row = (label: string) => page.getByText(label, { exact: true }).locator('xpath=..')
    await expect(row('Active mode')).toContainText('ECM')
    await expect(row('Scheduled mode')).toContainText('None')
    await expect(row('Boot default')).toContainText('NCM')
    await expect(page.getByRole('switch', { name: 'NCM after boot' })).toBeChecked()
    // Selecting a draft sends nothing.
    await page.getByRole('radio', { name: 'RNDIS' }).click()
    expect(agent.mutations()).toEqual([])
  })
})

test.describe('USB mode: confirm before submission', () => {
  test('the confirmation explains the disruption, experimental status and recovery before anything is sent', async ({ page, agent }) => {
    await openUsb(page)
    const dialog = await reviewNcm(page)
    await expect(dialog).toContainText('re-enumerates')
    await expect(dialog).toContainText('Wi-Fi')
    await expect(dialog).toContainText('experimental')
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
    expect(agent.mutations()).toEqual([])
  })

  test('Cancel sends zero requests and the draft stays editable', async ({ page, agent }) => {
    await openUsb(page)
    const dialog = await reviewNcm(page)
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toBeHidden()
    expect(agent.mutations()).toEqual([])
    await expect(page.getByRole('button', { name: 'Apply mode' })).toBeEnabled()
  })

  test('Escape sends zero requests', async ({ page, agent }) => {
    await openUsb(page)
    const dialog = await reviewNcm(page)
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    expect(agent.mutations()).toEqual([])
  })

  test('Confirm sends exactly one PUT /api/usb/mode with the reviewed NCM payload', async ({ page, agent }) => {
    agent.on('PUT', '/api/usb/mode', { data: NCM_SCHEDULED, status: 202 })
    await openUsb(page)
    const dialog = await reviewNcm(page)
    await dialog.getByRole('button', { name: 'Switch' }).click()
    await expect.poll(() => usbMutations(agent).length).toBe(1)
    expect(usbMutations(agent)[0].method).toBe('PUT')
    expect(usbMutations(agent)[0].body).toEqual({ mode: 'ncm', confirm_experimental: true })
    expect(agent.mutations()).toHaveLength(1)
    // Accepted is not applied: the scheduled mode is shown and the active mode is unchanged.
    await expect(page.getByRole('status').filter({ hasText: 'NCM scheduled' })).toBeVisible()
    await expect(page.getByText('Active mode', { exact: true }).locator('xpath=..')).toContainText('ECM')
    await expect(page.getByText('Scheduled mode', { exact: true }).locator('xpath=..')).toContainText('NCM')
  })

  test('ECM and RNDIS requests carry no experimental flag, and NCM to ECM is a rollback', async ({ page, agent }) => {
    agent.on('PUT', '/api/usb/mode', { data: {} })
    await openUsb(page)
    await page.getByRole('radio', { name: 'RNDIS' }).click()
    await page.getByRole('button', { name: 'Apply mode' }).click()
    const dialog = page.getByRole('dialog', { name: 'Switch USB to RNDIS?' })
    await expect(dialog).toContainText('re-enumerates')
    await dialog.getByRole('button', { name: 'Switch' }).click()
    await expect.poll(() => usbMutations(agent).length).toBe(1)
    expect(usbMutations(agent)[0].body).toEqual({ mode: 'rndis' })

    // From active NCM the dialog names the rollback.
    await page.reload()
    agent.on('GET', '/api/usb/status', { data: fx.usbStatus({ active_mode: 'ncm' }) })
    await openUsb(page)
    await page.getByRole('radio', { name: 'ECM' }).click()
    await page.getByRole('button', { name: 'Apply mode' }).click()
    await expect(page.getByRole('dialog', { name: 'Roll back to ECM?' })).toBeVisible()
    await page.keyboard.press('Escape')
    expect(usbMutations(agent)).toHaveLength(1)
  })

  test('a repeated Apply click and a repeated Confirm click still send one request', async ({ page, agent }) => {
    agent.on('PUT', '/api/usb/mode', { data: NCM_SCHEDULED, status: 202 })
    await openUsb(page)
    await page.getByRole('radio', { name: 'NCM' }).click()
    const apply = page.getByRole('button', { name: 'Apply mode' })
    await apply.evaluate((b: HTMLButtonElement) => {
      b.click()
      b.click()
    })
    const dialog = page.getByRole('dialog', { name: 'Switch USB to NCM?' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Switch' }).evaluate((b: HTMLButtonElement) => {
      b.click()
      b.click()
    })
    await expect.poll(() => usbMutations(agent).length).toBe(1)
    await page.waitForTimeout(300)
    expect(agent.mutations()).toHaveLength(1)
  })

  test('a rejected switch request shows an error, starts no verification and is not retried', async ({ page, agent }) => {
    agent.on('PUT', '/api/usb/mode', { error: 'mass_storage.0 function is missing', status: 400 })
    await openUsb(page)
    const dialog = await reviewNcm(page)
    await dialog.getByRole('button', { name: 'Switch' }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'mass_storage.0 function is missing' })).toBeVisible()
    await expect(page.getByText('NCM scheduled')).toHaveCount(0)
    expect(usbMutations(agent)).toHaveLength(1)
    await expect(page.getByRole('button', { name: 'Apply mode' })).toBeEnabled()
  })
})

test.describe('USB mode: verifying a scheduled switch', () => {
  test('scheduled with the old status stays "scheduled", then NCM becomes verified without resending', async ({ page, agent }) => {
    agent.on('PUT', '/api/usb/mode', { data: NCM_SCHEDULED, status: 202 })
    await openUsb(page, { clock: true })
    await freezeClock(page)
    const dialog = await reviewNcm(page)
    await dialog.getByRole('button', { name: 'Switch' }).click()
    const note = page.getByRole('status').filter({ hasText: 'NCM scheduled' })
    await expect(note).toBeVisible()
    await expect(note).toContainText('still ECM')
    // The immediate recheck read the old state.
    await expect.poll(() => statusReads(agent)).toBeGreaterThanOrEqual(2)

    await recheck(page, agent)
    await expect(note).toBeVisible()
    await expect(page.getByText('Active mode', { exact: true }).locator('xpath=..')).toContainText('ECM')

    agent.on('GET', '/api/usb/status', { data: fx.usbStatus({ active_mode: 'ncm' }) })
    await recheck(page, agent)
    await expect(page.getByRole('status').filter({ hasText: 'Verified: the active USB mode is now NCM' })).toBeVisible()
    await expect(page.getByText('Active mode', { exact: true }).locator('xpath=..')).toContainText('NCM')
    await expect(page.getByText('Scheduled mode', { exact: true }).locator('xpath=..')).toContainText('None')

    // Verification stopped: no further reads, and the mutation was never resent.
    const reads = statusReads(agent)
    await page.clock.runFor(12_000)
    await page.waitForTimeout(250)
    expect(statusReads(agent)).toBe(reads)
    expect(usbMutations(agent)).toHaveLength(1)
  })

  test('the recheck stops at its timeout with "Not verified", never resends, and Check again is read-only', async ({ page, agent }) => {
    agent.on('PUT', '/api/usb/mode', { data: NCM_SCHEDULED, status: 202 })
    await openUsb(page, { clock: true })
    await freezeClock(page)
    const dialog = await reviewNcm(page)
    await dialog.getByRole('button', { name: 'Switch' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'NCM scheduled' })).toBeVisible()

    const notVerified = page.getByRole('status').filter({ hasText: 'Not verified' })
    for (let i = 0; i < 20 && !(await notVerified.isVisible()); i++) await recheck(page, agent)
    await expect(notVerified).toBeVisible()
    await expect(notVerified).toContainText('still reads ECM')
    await expect(notVerified).toContainText('not repeated')
    await expect(page.getByText('Scheduled mode', { exact: true }).locator('xpath=..')).toContainText('NCM')

    const reads = statusReads(agent)
    await page.clock.runFor(12_000)
    await page.waitForTimeout(250)
    expect(statusReads(agent)).toBe(reads)
    expect(usbMutations(agent)).toHaveLength(1)

    // Check again re-reads status only.
    agent.on('GET', '/api/usb/status', { data: fx.usbStatus({ active_mode: 'ncm' }) })
    await page.getByRole('button', { name: 'Check again' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Verified' })).toBeVisible()
    expect(usbMutations(agent)).toHaveLength(1)
    expect(agent.mutations()).toHaveLength(1)
  })

  test('when the device stops answering it reads "Reconnect, verifying" and recovers when it returns', async ({ page, agent }) => {
    agent.on('PUT', '/api/usb/mode', { data: NCM_SCHEDULED, status: 202 })
    await openUsb(page, { clock: true })
    await freezeClock(page)
    const dialog = await reviewNcm(page)
    await dialog.getByRole('button', { name: 'Switch' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'NCM scheduled' })).toBeVisible()

    // The USB link drops: status requests fail at the network level.
    const outage = agent.defer('GET', '/api/usb/status')
    await page.clock.runFor(3000)
    await outage.waitForRequest()
    outage.abort()
    await expect(page.getByRole('status').filter({ hasText: 'Reconnect, verifying' })).toBeVisible()
    expect(usbMutations(agent)).toHaveLength(1)

    agent.on('GET', '/api/usb/status', { data: fx.usbStatus({ active_mode: 'ncm' }) })
    await recheck(page, agent)
    await expect(page.getByRole('status').filter({ hasText: 'Verified' })).toBeVisible()
    expect(usbMutations(agent)).toHaveLength(1)
  })

  test('an explicit agent error while verifying stops the recheck', async ({ page, agent }) => {
    agent.on('PUT', '/api/usb/mode', { data: NCM_SCHEDULED, status: 202 })
    await openUsb(page, { clock: true })
    await freezeClock(page)
    const dialog = await reviewNcm(page)
    await dialog.getByRole('button', { name: 'Switch' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'NCM scheduled' })).toBeVisible()
    agent.fail('GET', '/api/usb/status', { status: 503, error: 'synthetic ubus failure' })
    await recheck(page, agent)
    const alert = page.getByRole('alert').filter({ hasText: 'Not verified' })
    await expect(alert).toContainText('synthetic ubus failure')
    const reads = statusReads(agent)
    await page.clock.runFor(9000)
    await page.waitForTimeout(250)
    expect(statusReads(agent)).toBe(reads)
    expect(usbMutations(agent)).toHaveLength(1)
  })

  test('leaving the tab during verification stops the recheck', async ({ page, agent }) => {
    agent.on('PUT', '/api/usb/mode', { data: NCM_SCHEDULED, status: 202 })
    await openUsb(page, { clock: true })
    await freezeClock(page)
    const dialog = await reviewNcm(page)
    await dialog.getByRole('button', { name: 'Switch' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'NCM scheduled' })).toBeVisible()
    await page.getByRole('tab', { name: 'Tools', exact: true }).click()
    await page.clock.runFor(400) // let the lazy reveal settle
    await expect(page.getByText('AT console')).toBeVisible()
    const reads = statusReads(agent)
    await page.clock.runFor(9000)
    await page.waitForTimeout(250)
    expect(statusReads(agent)).toBe(reads)
    expect(usbMutations(agent)).toHaveLength(1)
  })
})

test.describe('USB boot default and powerbank', () => {
  test('enabling NCM after boot asks first; Cancel sends nothing; Confirm sends one reviewed PUT', async ({ page, agent }) => {
    agent.on('PUT', '/api/usb/default', { data: { default_mode: 'ncm', ncm_persist_on_boot: true } })
    await openUsb(page)
    const toggle = page.getByRole('switch', { name: 'NCM after boot' })
    await toggle.click()
    const dialog = page.getByRole('dialog', { name: 'Apply NCM after every boot?' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    expect(agent.mutations()).toEqual([])

    agent.on('GET', '/api/usb/status', { data: fx.usbStatus({ default_mode: 'ncm', ncm_persist_on_boot: true }) })
    await toggle.click()
    await dialog.getByRole('button', { name: 'Enable' }).click()
    await expect.poll(() => agent.mutations().length).toBe(1)
    expect(agent.mutations()[0].path).toBe('/api/usb/default')
    expect(agent.mutations()[0].body).toEqual({ mode: 'ncm', confirm_experimental: true })
    await expect(page.getByText('Boot default', { exact: true }).locator('xpath=..')).toContainText('NCM')
    await expect(page.getByText('Active mode', { exact: true }).locator('xpath=..')).toContainText('ECM')
  })
})

test.describe('Settings: theme', () => {
  test('the theme control is a named radio group', async ({ page }) => {
    await openApp(page, { group: 'system', tab: 'Settings' })
    const group = page.getByRole('radiogroup', { name: 'Theme' })
    await expect(group.getByRole('radio')).toHaveText(['Auto', 'Light', 'Dark'])
  })
})

test.describe('Tools: AT console', () => {
  test('the command and timeout fields have visible, associated labels', async ({ page, agent }) => {
    await openApp(page, { group: 'system', tab: 'Tools' })
    const command = page.getByRole('textbox', { name: 'AT command' })
    await expect(command).toBeVisible()
    await expect(page.getByText('AT command', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Timeout (seconds)')).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Timeout (seconds)' })).toHaveValue('2')
    await page.getByText('AT command', { exact: true }).click()
    await expect(command).toBeFocused()
    expect(agent.mutations()).toEqual([])
  })

  test('typing and Enter send only the command and timeout the UI always sent', async ({ page, agent }) => {
    agent.on('POST', '/api/at/send', (req) => ({ data: fx.atSendResult((req.body as { command: string }).command) }))
    await openApp(page, { group: 'system', tab: 'Tools' })
    const command = page.getByRole('textbox', { name: 'AT command' })
    await command.fill('ATI')
    expect(agent.mutations()).toEqual([])
    await page.getByRole('combobox', { name: 'Timeout (seconds)' }).selectOption('5')
    expect(agent.mutations()).toEqual([])
    await command.press('Enter')
    await expect.poll(() => agent.mutations().length).toBe(1)
    expect(agent.mutations()[0].path).toBe('/api/at/send')
    expect(agent.mutations()[0].body).toEqual({ command: 'ATI', timeout: 5 })
    await expect(page.getByText('> ATI')).toBeVisible()
  })

  test('a failed AT port read is reported, not shown as "no port"', async ({ page, agent }) => {
    agent.fail('GET', '/api/at/port', { status: 500, error: 'synthetic failure' })
    await openApp(page, { group: 'system', tab: 'Tools' })
    await expect(page.getByText('AT port status could not be read.')).toBeVisible()
    await expect(page.getByText('No AT port detected.')).toHaveCount(0)
  })
})

test.describe('Touch targets (coarse pointer)', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: VIEWPORTS.phone375 })

  test('USB radios, Apply and switches are at least 44 x 44 and do not overlap', async ({ page }) => {
    await openUsb(page)
    const targets = [
      ...(await page.getByRole('radiogroup', { name: 'USB mode' }).getByRole('radio').all()),
      page.getByRole('button', { name: 'Apply mode' }),
      page.getByRole('switch', { name: 'NCM after boot' }),
    ]
    const boxes = []
    for (const t of targets) {
      const box = await t.boundingBox()
      expect(box!.width).toBeGreaterThanOrEqual(43.5)
      expect(box!.height).toBeGreaterThanOrEqual(43.5)
      boxes.push(box!)
    }
    const radios = boxes.slice(0, 3)
    for (let i = 1; i < radios.length; i++) expect(radios[i].x).toBeGreaterThanOrEqual(radios[i - 1].x + radios[i - 1].width - 0.5)
  })
})

test.describe('Layout at 320 px', () => {
  test('Settings and Tools do not overflow horizontally and USB controls are not clipped', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.phone320)
    await openApp(page, { group: 'system', tab: 'Settings' })
    await expect(page.getByText('Active mode', { exact: true })).toBeVisible()
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(await overflow()).toBeLessThanOrEqual(0)
    for (const radio of await page.getByRole('radio').all()) {
      const box = await radio.boundingBox()
      expect(box!.x + box!.width).toBeLessThanOrEqual(320)
    }
    await page.getByRole('tab', { name: 'Tools', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'AT command' })).toBeVisible()
    expect(await overflow()).toBeLessThanOrEqual(0)
  })
})
