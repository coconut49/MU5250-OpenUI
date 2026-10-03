// PLAN2 R12: alert dismissal lasts one episode; recovery or escalation shows it again.
import { test, expect } from './support/harness'
import { openApp, advanceHeartbeat, freezeClock } from './support/app'
import * as fx from './support/fixtures'

const staleSignal = (age_ms: number) =>
  fx.dashboard({ network: 'SA', sources: { signal: { stale: true, age_ms, error: 'ubus timeout' } } })
const healthy = () => fx.dashboard({ network: 'SA' })
const hotBattery = (temperature: number) => fx.dashboard({ network: 'SA', battery: { temperature } })

test('a dismissed alert stays dismissed as its age updates, and returns after recovery', async ({ page, agent }) => {
  agent.on('GET', '/api/dashboard', { data: staleSignal(4000) })
  await openApp(page, { clock: true })
  const banner = page.getByText('Signal unavailable', { exact: true })
  await expect(banner).toBeVisible()
  await freezeClock(page)

  await page.getByRole('button', { name: 'Dismiss: Signal unavailable' }).click()
  await expect(banner).toBeHidden()
  agent.on('GET', '/api/dashboard', { data: staleSignal(9000) })
  await advanceHeartbeat(page, agent)
  await expect(banner).toBeHidden()
  // Still discoverable after dismissal.
  await expect(page.getByRole('button', { name: 'Show 1 dismissed alert' })).toBeVisible()

  agent.on('GET', '/api/dashboard', { data: healthy() })
  await advanceHeartbeat(page, agent)
  agent.on('GET', '/api/dashboard', { data: staleSignal(3000) })
  await advanceHeartbeat(page, agent)
  await expect(banner).toBeVisible()
})

test('a failed dashboard poll is not treated as recovery', async ({ page, agent }) => {
  agent.on('GET', '/api/dashboard', { data: staleSignal(4000) })
  await openApp(page, { clock: true })
  await freezeClock(page)
  await page.getByRole('button', { name: 'Dismiss: Signal unavailable' }).click()
  agent.fail('GET', '/api/dashboard', { times: 1, error: 'synthetic outage' })
  await advanceHeartbeat(page, agent)
  await expect(page.getByText('synthetic outage').first()).toBeVisible()
  agent.on('GET', '/api/dashboard', { data: staleSignal(12000) })
  await advanceHeartbeat(page, agent)
  await expect(page.getByText('Signal unavailable', { exact: true })).toBeHidden()
})

test('a dismissed warning that escalates to an error is shown and announced', async ({ page, agent }) => {
  agent.on('GET', '/api/dashboard', { data: hotBattery(460) })
  await openApp(page, { clock: true })
  await expect(page.getByText('Battery temperature high', { exact: true })).toBeVisible()
  await freezeClock(page)
  await page.getByRole('button', { name: 'Dismiss: Battery temperature high' }).click()
  agent.on('GET', '/api/dashboard', { data: hotBattery(510) })
  await advanceHeartbeat(page, agent)
  await expect(page.getByText('Battery temperature critically high', { exact: true })).toBeVisible()
  await expect(page.locator('[role="alert"][aria-live="assertive"]', { hasText: 'Battery temperature critically high' })).toHaveCount(1)
})

test('an unchanged episode is not re-announced as its age changes', async ({ page, agent }) => {
  agent.on('GET', '/api/dashboard', { data: staleSignal(4000) })
  await openApp(page, { clock: true })
  const polite = page.locator('[role="status"][aria-live="polite"]', { hasText: 'Signal unavailable' })
  await expect(polite).toHaveCount(1)
  await freezeClock(page)
  agent.on('GET', '/api/dashboard', { data: staleSignal(7000) })
  await advanceHeartbeat(page, agent)
  // The detail updated visibly; the live region text is unchanged, so nothing is re-announced.
  await expect(page.getByText('Last reading 7s ago', { exact: false })).toBeVisible()
  await expect(polite).toHaveCount(1)
})
