import { test, expect, type MockAgent } from './support/harness'
import { openApp } from './support/app'
import * as fx from './support/fixtures'

// PLAN2 R04/R05/U03 — Modem > Data. Everything runs against the synthetic agent.

type Json = Record<string, unknown>

/** A stateful usage source shared by the heartbeat (Home + Data tab) and the reset-day PUT. */
function useUsage(agent: MockAgent, initial: Json) {
  const state = { usage: fx.dataUsage(initial) as Json }
  agent.on('GET', '/api/dashboard', () => ({ data: fx.dashboard({ data_usage: state.usage }) }))
  return state
}

test.describe('billing cycle', () => {
  test('saving a reset day sends one PUT and Home and the Data tab agree afterwards', async ({ page, agent }) => {
    const state = useUsage(agent, { reset_enabled: 0, reset_day: 16, clear_date_record: '2026/09/16', next_clear_date: '20261016' })
    agent.on('PUT', '/api/data-usage/reset-day', () => {
      state.usage = fx.dataUsage({ reset_enabled: 1, reset_day: 20, clear_date_record: '2026/09/20', next_clear_date: '20261020' })
      return { data: state.usage }
    })
    await openApp(page, { group: 'modem', tab: 'Data' })

    await expect(page.getByText('Automatic reset disabled')).toBeVisible()
    await expect(page.getByText('Next reset')).toHaveCount(0)

    await page.getByRole('button', { name: 'Set reset day' }).click()
    const input = page.getByLabel('Reset day')
    await expect(input).toHaveValue('16')
    // The side effect is explained before saving, not after.
    await expect(page.getByText(/Saving also turns automatic reset on/)).toBeVisible()
    await input.fill('20')
    const dashboardsBefore = agent.requests({ method: 'GET', path: '/api/dashboard' }).length
    await page.getByRole('button', { name: 'Save and turn on automatic reset' }).click()

    await expect(page.getByText('20 Oct 2026')).toBeVisible()
    await expect(page.getByText('20 Sep 2026')).toBeVisible()
    await expect(page.getByText('Enabled', { exact: true })).toBeVisible()
    expect(agent.requests({ method: 'PUT', path: '/api/data-usage/reset-day' }).map((r) => r.body)).toEqual([{ reset_day: 20 }])
    expect(agent.mutations()).toHaveLength(1)
    // The heartbeat is re-read once; there is no separate usage poll.
    await expect.poll(() => agent.requests({ method: 'GET', path: '/api/dashboard' }).length).toBeGreaterThan(dashboardsBefore)

    // Home reads the same heartbeat resource: it renders the new state without another request to the setter.
    await page.getByRole('navigation').getByRole('button', { name: 'Home', exact: true }).click()
    await expect(page.getByText('Data usage')).toBeVisible()
    await page.getByRole('navigation').getByRole('button', { name: 'Modem', exact: true }).click()
    await page.getByRole('tab', { name: 'Data', exact: true }).click()
    await expect(page.getByText('20 Oct 2026')).toBeVisible()
    expect(agent.requests({ method: 'PUT', path: '/api/data-usage/reset-day' })).toHaveLength(1)
  })

  test('unknown reset configuration is shown as unknown, with no next-reset claim and no invented day', async ({ page, agent }) => {
    useUsage(agent, { reset_enabled: null, reset_day: null, clear_date_record: '', next_clear_date: '' })
    await openApp(page, { group: 'modem', tab: 'Data' })
    await expect(page.getByText('Automatic reset status unknown')).toBeVisible()
    await expect(page.getByText('Next reset')).toHaveCount(0)
    await expect(page.getByText('Disabled', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Reset day:')).toBeVisible()
    await expect(page.getByText('Reset day:').locator('..').getByText('Unavailable')).toBeAttached()

    await page.getByRole('button', { name: 'Set reset day' }).click()
    // No default of 1 when the device day is unknown.
    await expect(page.getByLabel('Reset day')).toHaveValue('')
    expect(agent.mutations()).toEqual([])
  })

  test('enabled reset shows the device dates, never a browser-date estimate', async ({ page, agent }) => {
    useUsage(agent, { reset_enabled: 1, reset_day: 31, clear_date_record: '2026/08/31', next_clear_date: '20260930' })
    await openApp(page, { group: 'modem', tab: 'Data' })
    await expect(page.getByText('31 Aug 2026')).toBeVisible()
    await expect(page.getByText('30 Sep 2026')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Current cycle' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Connection counters' })).toBeVisible()
    await expect(page.getByText(/restart when the mobile data connection restarts/)).toBeVisible()
    await expect(page.getByText('Since power on')).toHaveCount(0)
  })

  test('reset day is validated 1-31 before anything is sent', async ({ page, agent }) => {
    useUsage(agent, {})
    await openApp(page, { group: 'modem', tab: 'Data' })
    await page.getByRole('button', { name: 'Set reset day' }).click()
    const input = page.getByLabel('Reset day')
    for (const bad of ['0', '32', '']) {
      await input.fill(bad)
      await page.getByRole('button', { name: 'Save', exact: true }).click()
      await expect(page.getByText('Enter a whole number from 1 to 31.')).toBeVisible()
      await expect(input).toHaveAttribute('aria-invalid', 'true')
    }
    expect(agent.mutations()).toEqual([])
  })

  test('a failed save keeps the editor and the draft, and sends exactly one request', async ({ page, agent }) => {
    useUsage(agent, {})
    agent.on('PUT', '/api/data-usage/reset-day', { error: 'synthetic failure', status: 503 })
    await openApp(page, { group: 'modem', tab: 'Data' })
    await page.getByRole('button', { name: 'Set reset day' }).click()
    await page.getByLabel('Reset day').fill('9')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText('synthetic failure')).toBeVisible()
    await expect(page.getByLabel('Reset day')).toHaveValue('9')
    expect(agent.requests({ method: 'PUT', path: '/api/data-usage/reset-day' })).toHaveLength(1)
  })
})

test.describe('unavailable counters', () => {
  test('null counters render as unavailable: no NaN, no fabricated zero total; a real zero stays 0 B', async ({ page, agent }) => {
    useUsage(agent, {
      cycle: { rx_bytes: 5_000_000_000, tx_bytes: null, time_secs: null },
      since_power_on: { rx_bytes: 0, tx_bytes: 0, time_secs: 0 },
      day: { rx_bytes: null, tx_bytes: null, time_secs: null },
    })
    await openApp(page, { group: 'modem', tab: 'Data' })
    const cycle = page.locator('section', { has: page.getByRole('heading', { name: 'Current cycle' }) })
    await expect(cycle.getByText('5.0 GB')).toBeVisible()
    // Upload and Total are unknown: the total is not 5.0 GB and not 0.
    const upload = cycle.getByText('Upload').locator('..')
    await expect(upload.getByText('Unavailable')).toBeAttached()
    const total = cycle.getByText('Total', { exact: true }).locator('..')
    await expect(total.getByText('Unavailable')).toBeAttached()
    await expect(total).not.toContainText('5.0 GB')

    const connection = page.locator('section', { has: page.getByRole('heading', { name: 'Connection counters' }) })
    await expect(connection.getByText('0 B')).toHaveCount(3)

    const body = await page.locator('main').innerText()
    expect(body).not.toMatch(/NaN|undefined|Infinity/)
  })

  test('a failed heartbeat with no data shows an error and Retry, not an endless skeleton', async ({ page, agent }) => {
    agent.fail('GET', '/api/dashboard', { status: 503, error: 'synthetic outage' })
    await openApp(page, { group: 'modem', tab: 'Data' })
    await expect(page.getByText(/Data usage could not be loaded/).first()).toBeVisible()
    agent.on('GET', '/api/dashboard', () => ({ data: fx.dashboard() }))
    await page.getByRole('button', { name: 'Retry' }).first().click()
    await expect(page.getByRole('heading', { name: 'Current cycle' })).toBeVisible()
  })
})
