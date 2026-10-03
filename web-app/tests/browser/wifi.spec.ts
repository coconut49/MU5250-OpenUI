import type { Locator, Page } from '@playwright/test'
import { test, expect, type MockAgent } from './support/harness'
import { openApp } from './support/app'
import * as fx from './support/fixtures'

/**
 * Wi-Fi tab: TX power (R09), drafts (R03), connection confirmations (R11), read states (R07),
 * advice wording (R13). Every request is answered by the synthetic agent; no device is involved.
 */

const SETTINGS = '/api/wifi/settings'
const STATUS = '/api/wifi/status'
const OK = { data: { status: 'ok', changed: true } }

const card = (page: Page, label: '2.4 GHz' | '5 GHz'): Locator =>
  page.locator('section').filter({ has: page.getByRole('heading', { name: label, exact: true }) })

async function openWifi(page: Page, agent: MockAgent, over?: Record<string, unknown>) {
  if (over) agent.on('GET', STATUS, { data: fx.wifiStatus(over) })
  agent.on('PUT', SETTINGS, OK)
  await openApp(page, { group: 'network', tab: 'Wi-Fi' })
  await expect(page.getByText('Master switch')).toBeVisible()
}

const puts = (agent: MockAgent) => agent.requests({ method: 'PUT', path: SETTINGS })

async function edit(page: Page, label: '2.4 GHz' | '5 GHz') {
  await page.getByRole('button', { name: `Edit ${label} settings` }).click()
  return card(page, label)
}

test.describe('TX power (R09)', () => {
  test('a saved 25% reopens as 25%, not as a blank "Default"', async ({ page, agent }) => {
    await openWifi(page, agent, { txpower_5g: '25' })
    await expect(card(page, '5 GHz').getByText('25%')).toBeVisible()
    const c = await edit(page, '5 GHz')
    await expect(c.getByRole('textbox', { name: 'TX power (%)' })).toHaveValue('25')
    await expect(c.getByText('Default')).toHaveCount(0)
    expect(agent.mutations()).toEqual([])
  })

  test('the observed 80%, which is not a preset, is shown and editable', async ({ page, agent }) => {
    await openWifi(page, agent)
    const c = await edit(page, '2.4 GHz')
    const tx = c.getByRole('textbox', { name: 'TX power (%)' })
    await expect(tx).toHaveValue('80')
    await tx.fill('60')
    await page.getByRole('button', { name: 'Save 2.4 GHz settings' }).click()
    const dialog = page.getByRole('dialog', { name: 'Apply 2.4 GHz Wi-Fi changes?' })
    await expect(dialog).toContainText('80% → 60%')
    await dialog.getByRole('button', { name: 'Apply changes' }).click()
    await expect.poll(() => puts(agent).length).toBe(1)
    expect(puts(agent)[0].body).toEqual({ txpower_2g: 60 })
  })

  test('an explicit 100 sends 100 for the right band', async ({ page, agent }) => {
    await openWifi(page, agent)
    const c = await edit(page, '5 GHz')
    await c.getByRole('textbox', { name: 'TX power (%)' }).fill('100')
    await page.getByRole('button', { name: 'Save 5 GHz settings' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Apply changes' }).click()
    await expect.poll(() => puts(agent).length).toBe(1)
    expect(puts(agent)[0].body).toEqual({ txpower_5g: 100 })
  })

  test('an unrelated save omits txpower entirely', async ({ page, agent }) => {
    await openWifi(page, agent)
    const c = await edit(page, '2.4 GHz')
    await c.getByRole('textbox', { name: 'SSID' }).fill('Renamed-Net')
    await page.getByRole('button', { name: 'Save 2.4 GHz settings' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Apply changes' }).click()
    await expect.poll(() => puts(agent).length).toBe(1)
    expect(puts(agent)[0].body).toEqual({ ssid_2g: 'Renamed-Net' })
  })

  test('0, 101 and decimals are rejected before anything is sent', async ({ page, agent }) => {
    await openWifi(page, agent)
    const c = await edit(page, '2.4 GHz')
    const tx = c.getByRole('textbox', { name: 'TX power (%)' })
    const save = page.getByRole('button', { name: 'Save 2.4 GHz settings' })
    for (const bad of ['0', '101', '12.5']) {
      await tx.fill(bad)
      await expect(c.getByText('Enter a whole number from 1 to 100.')).toBeVisible()
      await expect(tx).toHaveAttribute('aria-invalid', 'true')
      await expect(save).toBeDisabled()
    }
    await tx.fill('1')
    await expect(save).toBeEnabled()
    expect(agent.mutations()).toEqual([])
  })

  test('unknown TX power stays blank ("Keep current") and is not sent', async ({ page, agent }) => {
    await openWifi(page, agent, { txpower_2g: '' })
    await expect(card(page, '2.4 GHz').getByText('Configured TX power')).toBeVisible()
    const c = await edit(page, '2.4 GHz')
    const tx = c.getByRole('textbox', { name: 'TX power (%)' })
    await expect(tx).toHaveValue('')
    await expect(tx).toHaveAttribute('placeholder', 'Keep current')
    await c.getByRole('textbox', { name: 'SSID' }).fill('Only-Name')
    await page.getByRole('button', { name: 'Save 2.4 GHz settings' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Apply changes' }).click()
    await expect.poll(() => puts(agent).length).toBe(1)
    expect(puts(agent)[0].body).toEqual({ ssid_2g: 'Only-Name' })
  })

  test('the status is re-read after acknowledgement and the verified value is shown', async ({ page, agent }) => {
    await openWifi(page, agent)
    const c = await edit(page, '5 GHz')
    await c.getByRole('textbox', { name: 'TX power (%)' }).fill('100')
    const before = agent.requests({ method: 'GET', path: STATUS }).length
    agent.on('GET', STATUS, { data: fx.wifiStatus({ txpower_5g: '100' }) })
    await page.getByRole('button', { name: 'Save 5 GHz settings' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Apply changes' }).click()
    await expect(page.getByText('the device now reports the new settings')).toBeVisible()
    expect(agent.requests({ method: 'GET', path: STATUS }).length).toBe(before + 1)
    await expect(card(page, '5 GHz').getByText('100%')).toBeVisible()
  })

  test('a failed read-back is shown as unverified, never as a confirmed value', async ({ page, agent }) => {
    await openWifi(page, agent)
    const c = await edit(page, '5 GHz')
    await c.getByRole('textbox', { name: 'TX power (%)' }).fill('100')
    agent.fail('GET', STATUS, { times: 1 })
    await page.getByRole('button', { name: 'Save 5 GHz settings' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Apply changes' }).click()
    await expect(page.getByText(/could not be read back/)).toBeVisible()
    await expect(page.getByText('the device now reports the new settings')).toHaveCount(0)
    // A read-only check recovers; the mutation is never repeated.
    agent.on('GET', STATUS, { data: fx.wifiStatus({ txpower_5g: '100' }) })
    await page.getByRole('button', { name: 'Check device' }).click()
    await expect(page.getByText('the device now reports the new settings')).toBeVisible()
    expect(puts(agent)).toHaveLength(1)
  })
})

test.describe('confirmations before connection-dropping changes (R11)', () => {
  test('Cancel on the Wi-Fi-off confirmation sends nothing; Confirm sends exactly one reviewed PUT', async ({ page, agent }) => {
    await openWifi(page, agent)
    const master = page.getByRole('switch', { name: 'Master Wi-Fi switch' })
    await master.click()
    const dialog = page.getByRole('dialog', { name: 'Turn off all Wi-Fi?' })
    await expect(dialog).toContainText('possibly this browser')
    await expect(dialog).toContainText('Mobile data')
    await expect(dialog).toContainText('USB-C')
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toBeHidden()
    expect(agent.mutations()).toEqual([])

    await master.click()
    await dialog.getByRole('button', { name: 'Turn off Wi-Fi' }).click()
    await expect.poll(() => agent.mutations().length).toBe(1)
    await page.waitForTimeout(200)
    expect(agent.mutations().map((r) => [r.method, r.path, r.body])).toEqual([['PUT', SETTINGS, { wifi_onoff: '0' }]])
  })

  test('after acknowledgement the page says "applied, verifying" until the read-back arrives', async ({ page, agent }) => {
    await openWifi(page, agent)
    const held = agent.defer('GET', STATUS)
    await page.getByRole('switch', { name: 'Master Wi-Fi switch' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Turn off Wi-Fi' }).click()
    await held.waitForRequest()
    await expect(page.getByText(/Global Wi-Fi: applied\..*Verifying/)).toBeVisible()
    await expect(page.getByText('the device now reports')).toHaveCount(0)
    held.resolve(fx.wifiStatus({ wifi_onoff: '0' }))
    await expect(page.getByText('Global Wi-Fi: the device now reports the new settings.')).toBeVisible()
    await expect(page.getByText('Off — all Wi-Fi radios are globally disabled')).toBeVisible()
  })

  test('turning Wi-Fi back on needs no confirmation', async ({ page, agent }) => {
    await openWifi(page, agent, { wifi_onoff: '0' })
    await page.getByRole('switch', { name: 'Master Wi-Fi switch' }).click()
    await expect.poll(() => agent.mutations().length).toBe(1)
    expect(agent.mutations()[0].body).toEqual({ wifi_onoff: '1' })
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('turning one band off names the band and its recovery path', async ({ page, agent }) => {
    await openWifi(page, agent)
    await page.getByRole('switch', { name: '5 GHz radio' }).click()
    const dialog = page.getByRole('dialog', { name: 'Turn off 5 GHz Wi-Fi?' })
    await expect(dialog).toContainText('Devices connected on 5 GHz, possibly this browser, will disconnect')
    await expect(dialog).toContainText('Reconnect to the 2.4 GHz network or use USB-C')
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    expect(agent.mutations()).toEqual([])

    await page.getByRole('switch', { name: '5 GHz radio' }).click()
    await dialog.getByRole('button', { name: 'Turn off 5 GHz' }).click()
    await expect.poll(() => agent.mutations().length).toBe(1)
    expect(agent.mutations()[0].body).toEqual({ radio5_disabled: '1' })
  })

  test('saving SSID/security-class settings: Cancel sends nothing, Confirm sends the reviewed body and hides the password', async ({ page, agent }) => {
    await openWifi(page, agent)
    const c = await edit(page, '2.4 GHz')
    await c.getByRole('textbox', { name: 'SSID' }).fill('Brand-New')
    await c.getByLabel('Password').fill('synthetic-secret-1')
    await c.getByLabel('Channel').selectOption('11')
    const save = page.getByRole('button', { name: 'Save 2.4 GHz settings' })
    await save.click()
    const dialog = page.getByRole('dialog', { name: 'Apply 2.4 GHz Wi-Fi changes?' })
    await expect(dialog).toContainText('Synthetic-WiFi → Brand-New')
    await expect(dialog).toContainText('Changed (not shown)')
    await expect(dialog).toContainText('Auto → 11')
    expect(await dialog.textContent()).not.toContain('synthetic-secret-1')
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    expect(agent.mutations()).toEqual([])
    // The draft is still there after Cancel.
    await expect(c.getByRole('textbox', { name: 'SSID' })).toHaveValue('Brand-New')

    await save.click()
    await dialog.getByRole('button', { name: 'Apply changes' }).click()
    await expect.poll(() => puts(agent).length).toBe(1)
    await page.waitForTimeout(200)
    expect(puts(agent)).toHaveLength(1)
    expect(puts(agent)[0].body).toEqual({ ssid_2g: 'Brand-New', key_2g: 'synthetic-secret-1', channel_2g: '11' })
  })

  test('band sync is reviewed first and sends the copied settings once', async ({ page, agent }) => {
    await openWifi(page, agent, { key_2g: 'synthetic-pass-9', ssid_2g: 'Copy-Me' })
    await page.getByRole('button', { name: 'Use 2.4 GHz for both' }).click()
    const dialog = page.getByRole('dialog', { name: 'Copy 2.4 GHz settings to 5 GHz?' })
    await expect(dialog).toContainText('Copy-Me')
    await expect(dialog).toContainText('Copied (not shown)')
    await expect(dialog).toContainText('Devices connected on 5 GHz, possibly this browser')
    expect(await dialog.textContent()).not.toContain('synthetic-pass-9')
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    expect(agent.mutations()).toEqual([])

    await page.getByRole('button', { name: 'Use 2.4 GHz for both' }).click()
    await dialog.getByRole('button', { name: 'Copy settings' }).click()
    await expect.poll(() => puts(agent).length).toBe(1)
    expect(puts(agent)[0].body).toEqual({
      ssid_5g: 'Copy-Me', hidden_5g: '0', encryption_5g: 'psk3-mixed', key_5g: 'synthetic-pass-9',
    })
  })

  test('a request that gets no reply is reported as uncertain and is never retried', async ({ page, agent }) => {
    await openWifi(page, agent)
    const held = agent.defer('PUT', SETTINGS)
    await page.getByRole('switch', { name: '2.4 GHz radio' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Turn off 2.4 GHz' }).click()
    await held.waitForRequest()
    held.abort()
    await expect(page.getByText(/no reply from the device.*may or may not have applied/)).toBeVisible()
    await page.waitForTimeout(300)
    expect(puts(agent)).toHaveLength(1)
    // The check is read-only: it reads the settings and compares, it does not resend.
    agent.on('GET', STATUS, { data: fx.wifiStatus({ radio2_disabled: '1' }) })
    await page.getByRole('button', { name: 'Check device' }).click()
    await expect(page.getByText('2.4 GHz radio: the device now reports the new settings.')).toBeVisible()
    expect(puts(agent)).toHaveLength(1)
  })

  test('a rejected save keeps the draft for correction', async ({ page, agent }) => {
    await openWifi(page, agent)
    agent.on('PUT', SETTINGS, { error: 'txpower_2g is outside the supported values', status: 400 })
    const c = await edit(page, '2.4 GHz')
    await c.getByRole('textbox', { name: 'SSID' }).fill('Keep-Me')
    await page.getByRole('button', { name: 'Save 2.4 GHz settings' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Apply changes' }).click()
    await expect(page.getByText('2.4 GHz settings failed')).toHaveCount(0)
    await expect(page.getByText('txpower_2g is outside the supported values')).toBeVisible()
    await expect(c.getByRole('textbox', { name: 'SSID' })).toHaveValue('Keep-Me')
    expect(puts(agent)).toHaveLength(1)
  })
})

test.describe('drafts survive re-reads (R03)', () => {
  test('an unsaved 5 GHz edit survives saving and refreshing 2.4 GHz; Cancel then restores the observation', async ({ page, agent }) => {
    await openWifi(page, agent)
    const c5 = await edit(page, '5 GHz')
    await c5.getByRole('textbox', { name: 'SSID' }).fill('Unsaved-5')
    await expect(c5.getByText('Unsaved changes')).toBeVisible()

    const c2 = await edit(page, '2.4 GHz')
    await c2.getByRole('textbox', { name: 'SSID' }).fill('Saved-24')
    agent.on('GET', STATUS, { data: fx.wifiStatus({ ssid_2g: 'Saved-24' }) })
    await page.getByRole('button', { name: 'Save 2.4 GHz settings' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Apply changes' }).click()

    await expect(page.getByText('2.4 GHz settings: the device now reports the new settings.')).toBeVisible()
    await expect(card(page, '2.4 GHz').getByText('Saved-24')).toBeVisible()
    await expect(c5.getByRole('textbox', { name: 'SSID' })).toHaveValue('Unsaved-5')
    await expect(c5.getByText('Unsaved changes')).toBeVisible()
    expect(puts(agent)).toHaveLength(1)
    expect(puts(agent)[0].body).toEqual({ ssid_2g: 'Saved-24' })

    await page.getByRole('button', { name: 'Cancel editing 5 GHz' }).click()
    await expect(card(page, '5 GHz').getByText('Synthetic-WiFi')).toBeVisible()
    await edit(page, '5 GHz')
    await expect(c5.getByRole('textbox', { name: 'SSID' })).toHaveValue('Synthetic-WiFi')
  })

  test('a real external change to a dirty draft is flagged, keeps the edit, and Reload restores the device value', async ({ page, agent }) => {
    await openWifi(page, agent)
    const c = await edit(page, '2.4 GHz')
    // Dirty: a manual re-read (via an unrelated save of the OTHER band) after an external SSID change.
    await c.getByRole('textbox', { name: 'SSID' }).fill('Mine')
    const c5 = await edit(page, '5 GHz')
    await c5.getByRole('textbox', { name: 'SSID' }).fill('Other-5')
    agent.on('GET', STATUS, { data: fx.wifiStatus({ ssid_2g: 'External-Change', ssid_5g: 'Other-5' }) })
    await page.getByRole('button', { name: 'Save 5 GHz settings' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Apply changes' }).click()
    await expect(c.getByText(/The device changed this band's settings while you were editing/)).toBeVisible()
    await expect(c.getByRole('textbox', { name: 'SSID' })).toHaveValue('Mine')
    await c.getByRole('button', { name: 'Reload from device' }).click()
    await expect(c.getByRole('textbox', { name: 'SSID' })).toHaveValue('External-Change')
    await expect(c.getByText(/The device changed/)).toHaveCount(0)
  })
})

test.describe('read states (R07)', () => {
  test('a Wi-Fi read failure ends loading with an error and Retry recovers', async ({ page, agent }) => {
    agent.fail('GET', STATUS, { times: 1, error: 'ubus timeout' })
    agent.on('PUT', SETTINGS, OK)
    await openApp(page, { group: 'network', tab: 'Wi-Fi' })
    const alert = page.getByRole('alert').filter({ hasText: 'Could not read the Wi-Fi settings' })
    await expect(alert).toContainText('ubus timeout')
    await expect(page.getByText('Master switch')).toHaveCount(0)
    await alert.getByRole('button', { name: 'Retry' }).click()
    await expect(page.getByText('Master switch')).toBeVisible()
    await expect(alert).toHaveCount(0)
  })
})

test.describe('advice wording (R13)', () => {
  test('never claims "no obvious channel conflicts" and omits the empty advice section', async ({ page, agent }) => {
    await openWifi(page, agent, { actual_bw_5g: '80 MHz', htmode_5g: 'EHT80', channel_5g: '44', clients_5g: 40 })
    const c5 = card(page, '5 GHz')
    await expect(c5.getByText('Configured width')).toBeVisible()
    await expect(c5.getByText('Current width')).toBeVisible()
    await expect(page.getByText(/no obvious|no conflict|improve stability/i)).toHaveCount(0)
    await expect(c5.getByText('Configuration notes')).toHaveCount(0)
  })

  test('compares widths numerically: EHT80 vs 80 MHz is silent, EHT80 vs 40 MHz is an observation', async ({ page, agent }) => {
    await openWifi(page, agent, { actual_bw_5g: '40 MHz' })
    const c5 = card(page, '5 GHz')
    await expect(c5.getByText('Configured width is 80 MHz; the radio is currently operating at 40 MHz.')).toBeVisible()
    await expect(card(page, '2.4 GHz').getByText(/Configured width is/)).toHaveCount(0)
  })

  test('a 2.4 GHz channel note says no scan was run', async ({ page, agent }) => {
    await openWifi(page, agent, { channel_2g: '3', actual_channel_2g: 3 })
    await expect(card(page, '2.4 GHz').getByText(/No scan of nearby networks was run/)).toBeVisible()
  })
})

test.describe('labels and names (U03/U06)', () => {
  test('every switch and field has an accessible name', async ({ page, agent }) => {
    await openWifi(page, agent)
    await edit(page, '2.4 GHz')
    const unnamed = await page.evaluate(() => {
      const bad: string[] = []
      for (const el of document.querySelectorAll('[role="switch"], input, select')) {
        const labelled =
          el.getAttribute('aria-label') ||
          el.getAttribute('aria-labelledby') ||
          (el as HTMLInputElement).labels?.length
        if (!labelled) bad.push(el.outerHTML.slice(0, 80))
      }
      return bad
    })
    expect(unnamed).toEqual([])
    await expect(page.getByRole('switch', { name: 'Hidden SSID' })).toBeVisible()
  })
})

test.describe('touch (U06) at 375 px', () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true })

  test('switches, Edit, Save and Cancel have 44 x 44 hit areas', async ({ page, agent }) => {
    await openWifi(page, agent)
    await edit(page, '2.4 GHz')
    const targets = [
      page.getByRole('switch', { name: 'Master Wi-Fi switch' }),
      page.getByRole('switch', { name: '5 GHz radio' }),
      page.getByRole('switch', { name: 'Hidden SSID' }),
      page.getByRole('button', { name: 'Edit 5 GHz settings' }),
      page.getByRole('button', { name: 'Save 2.4 GHz settings' }),
      page.getByRole('button', { name: 'Cancel editing 2.4 GHz' }),
    ]
    for (const t of targets) {
      const box = await t.boundingBox()
      expect(box, await t.evaluate((e) => e.outerHTML.slice(0, 80))).not.toBeNull()
      expect(box!.width).toBeGreaterThanOrEqual(43.5)
      expect(box!.height).toBeGreaterThanOrEqual(43.5)
    }
  })
})
