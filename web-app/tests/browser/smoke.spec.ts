import { test, expect } from './support/harness'
import { openApp, advanceHeartbeat, freezeClock } from './support/app'
import * as fx from './support/fixtures'

const dashboardRequests = (agent: { requests: (f: { method: string; path: string }) => unknown[] }) =>
  agent.requests({ method: 'GET', path: '/api/dashboard' })

test('Home renders fixture values with no unhandled or external requests', async ({ page, agent }) => {
  agent.on('GET', '/api/dashboard', { data: fx.dashboard({ network: 'SA', battery: { capacity: 78 } }) })
  await openApp(page)
  // Stable fixture-derived number rather than copy: battery 78 %.
  await expect(page.getByText('78').first()).toBeVisible()
  expect(dashboardRequests(agent).length).toBeGreaterThan(0)
  expect(agent.unhandled()).toEqual([])
  expect(agent.blocked()).toEqual([])
  expect(agent.mutations()).toEqual([])
})

test('first dashboard failure shows an error state, then the next poll recovers', async ({ page, agent }) => {
  const first = agent.defer('GET', '/api/dashboard')
  await openApp(page, { clock: true })
  await first.waitForRequest()
  first.reject('synthetic outage', 503)
  // The agent's error text is shown verbatim; asserting on it avoids depending on banner copy.
  const alert = page.getByText('synthetic outage').first()
  await expect(alert).toBeVisible()
  await freezeClock(page)

  // Recovery: the default fixture answers the next heartbeat.
  await advanceHeartbeat(page, agent)
  await expect(alert).toBeHidden()
  await expect(page.getByText('78').first()).toBeVisible()
})

test('fail() and abort() surface as distinct error states', async ({ page, agent }) => {
  agent.fail('GET', '/api/dashboard', { times: 1, status: 500, error: 'synthetic outage' })
  await openApp(page, { clock: true })
  await expect(page.getByText('synthetic outage').first()).toBeVisible()
  await freezeClock(page)

  const held = agent.defer('GET', '/api/dashboard')
  await page.clock.runFor(3000)
  await held.waitForRequest()
  held.abort()
  await expect(page.getByText(/Failed to reach the agent/).first()).toBeVisible()
})

test('advancing the clock triggers exactly one further dashboard request', async ({ page, agent }) => {
  await openApp(page, { clock: true })
  await expect(page.getByText('78').first()).toBeVisible()
  await freezeClock(page)
  const before = dashboardRequests(agent).length
  expect(before).toBe(1)

  await advanceHeartbeat(page, agent, 3000)
  expect(dashboardRequests(agent)).toHaveLength(before + 1)
  // Nothing else fires until time moves again.
  await page.waitForTimeout(250)
  expect(dashboardRequests(agent)).toHaveLength(before + 1)
})
