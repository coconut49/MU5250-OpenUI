// PLAN2 R15: the charge-limit range edits a local draft; only Apply writes.
// Every charge-control mutation is mocked — nothing reaches a charger.
import type { Page } from '@playwright/test'
import { test, expect } from './support/harness'
import { openApp, advanceHeartbeat, freezeClock } from './support/app'
import * as fx from './support/fixtures'

const PATH = '/api/device/charge-control'
const enabled = fx.chargeControl({ charge_limit_enabled: true, charge_limit: 90 })

async function openMetrics(page: Page) {
  await openApp(page, { group: 'system', tab: 'Metrics', clock: true })
  const range = page.getByLabel('Stop charging at')
  await expect(range).toHaveValue('90')
  await freezeClock(page)
  return range
}

test.beforeEach(({ agent }) => {
  agent.on('GET', PATH, { data: enabled })
})

test('clicking, Tab, Escape and unrelated keys never write the limit', async ({ page, agent }) => {
  const range = await openMetrics(page)
  await range.click()          // pointer down/up: moves the thumb, i.e. edits the draft only
  await range.press('Shift')   // unrelated keyup
  await range.press('Tab')
  await range.focus()
  await range.press('Escape')  // discards the pointer draft
  await expect(range).toHaveValue('90')
  await range.press('ArrowLeft')
  await expect(range).toHaveValue('85')
  await range.press('Escape')
  await expect(range).toHaveValue('90')
  expect(agent.mutations()).toEqual([])
})

test('keyboard edits survive polls and Apply sends the draft once', async ({ page, agent }) => {
  const range = await openMetrics(page)
  await range.focus()
  await range.press('ArrowLeft')
  await range.press('ArrowLeft')
  await expect(range).toHaveValue('80')
  // A poll carrying the old device value must not overwrite the draft.
  await page.clock.runFor(10_000)
  await expect.poll(() => agent.requests({ method: 'GET', path: PATH }).length).toBeGreaterThan(1)
  await expect(range).toHaveValue('80')

  agent.on('PUT', PATH, (req) => ({ data: { ...enabled, ...(req.body as object) } }))
  const apply = page.getByRole('button', { name: 'Apply limit' })
  await apply.click()
  await expect(range).toHaveValue('80')
  await expect(apply).toBeHidden()
  const writes = agent.mutations()
  expect(writes).toHaveLength(1)
  expect(writes[0].body).toEqual({ charge_limit: 80 })
})

test('Cancel discards the draft without a request; same value offers no Apply', async ({ page, agent }) => {
  const range = await openMetrics(page)
  await range.focus()
  await range.press('ArrowRight')
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(range).toHaveValue('90')

  await range.press('ArrowLeft')
  await range.press('ArrowRight')
  await expect(page.getByRole('button', { name: 'Apply limit' })).toBeDisabled()
  expect(agent.mutations()).toEqual([])
})

test('a rejected save keeps the draft and explains the failure', async ({ page, agent }) => {
  const range = await openMetrics(page)
  await range.focus()
  await range.press('ArrowLeft')
  agent.on('PUT', PATH, { error: 'charger busy', status: 503 })
  await page.getByRole('button', { name: 'Apply limit' }).click()
  await expect(page.getByText('Change not applied: charger busy')).toBeVisible()
  await expect(range).toHaveValue('85')
  expect(agent.mutations()).toHaveLength(1)
})

test('the authoritative reply wins over the draft and over older polls', async ({ page, agent }) => {
  const range = await openMetrics(page)
  await range.focus()
  await range.press('ArrowLeft')
  // Device clamps the request and reports 95; a poll that started earlier still says 90.
  const stalePoll = agent.defer('GET', PATH)
  await page.clock.runFor(10_000)
  await stalePoll.waitForRequest()
  agent.on('PUT', PATH, { data: { ...enabled, charge_limit: 95 } })
  await page.getByRole('button', { name: 'Apply limit' }).click()
  await expect(range).toHaveValue('95')
  stalePoll.resolve(enabled)
  await advanceHeartbeat(page, agent, 0, PATH).catch(() => {})
  await expect(range).toHaveValue('95')
})

test('the range is disabled while the enforcer is off', async ({ page, agent }) => {
  agent.on('GET', PATH, { data: fx.chargeControl({ charge_limit_enabled: false, charge_limit: 90 }) })
  await openApp(page, { group: 'system', tab: 'Metrics' })
  await expect(page.getByLabel('Stop charging at')).toBeDisabled()
  expect(agent.mutations()).toEqual([])
})
