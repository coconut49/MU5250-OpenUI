import { test, expect } from './support/harness'
import { openApp } from './support/app'
import * as fx from './support/fixtures'

// PLAN2 R07/U03 — Modem > TTL.

const openTtl = (page: Parameters<typeof openApp>[0]) => openApp(page, { group: 'modem', tab: 'TTL' })

test.describe('TTL read states', () => {
  test('a status failure shows an error and Retry, never an endless "Checking status" or a fake "disabled"', async ({ page, agent }) => {
    agent.fail('GET', '/api/ttl/status', { status: 503, error: 'synthetic outage' })
    await openTtl(page)
    await expect(page.getByText(/TTL status could not be read/)).toBeVisible()
    await expect(page.getByText('Checking status')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Enable clamping' })).toHaveCount(0)
    await expect(page.getByLabel('TTL value')).toHaveCount(0)

    agent.on('GET', '/api/ttl/status', { data: fx.ttlStatus({ active: true, ipv6_active: true, ttl_value: 64 }) })
    await page.getByRole('button', { name: 'Retry' }).click()
    await expect(page.getByText('Active (TTL=64)')).toBeVisible()
    await expect(page.getByText('IPv4 + IPv6')).toBeVisible()
  })

  test('a payload without readable fields is unknown, not disabled', async ({ page, agent }) => {
    agent.on('GET', '/api/ttl/status', { data: {} })
    await openTtl(page)
    await expect(page.getByText(/did not report whether TTL clamping is on/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Enable clamping' })).toHaveCount(0)
    expect(agent.mutations()).toEqual([])
  })

  test('the TTL input has a real label in both the inactive and the active branch', async ({ page, agent }) => {
    await openTtl(page)
    const input = page.getByLabel('TTL value')
    await expect(input).toHaveValue('65')
    await expect(page.getByText('1 to 255')).toBeVisible()
    await expect(page.getByRole('spinbutton', { name: 'TTL value' })).toBeVisible()

    agent.on('GET', '/api/ttl/status', { data: fx.ttlStatus({ active: true, ipv6_active: false, ttl_value: 64 }) })
    await page.getByRole('tab', { name: 'APN' }).click()
    await page.getByRole('tab', { name: 'TTL' }).click()
    await expect(page.getByText('Active (TTL=64)')).toBeVisible()
    await expect(page.getByRole('spinbutton', { name: 'TTL value' })).toHaveValue('64')
    await expect(page.getByText('IPv4 only')).toBeVisible()
  })

  test('a refresh failure after success keeps the last status, marked stale', async ({ page, agent }) => {
    agent.on('GET', '/api/ttl/status', { data: fx.ttlStatus({ active: true, ipv6_active: true, ttl_value: 64 }) })
    await openTtl(page)
    await expect(page.getByText('Active (TTL=64)')).toBeVisible()
    agent.fail('GET', '/api/ttl/status', { status: 503, error: 'synthetic outage' })
    await page.getByRole('tab', { name: 'APN' }).click()
    await page.getByRole('tab', { name: 'TTL' }).click()
    await expect(page.getByText(/Showing the last TTL status read/)).toBeVisible()
    await expect(page.getByText('Active (TTL=64)')).toBeVisible()
  })
})

test.describe('TTL changes', () => {
  test('Enable validates, sends one PUT with the typed value and re-reads the status', async ({ page, agent }) => {
    let status = fx.ttlStatus()
    agent.on('GET', '/api/ttl/status', () => ({ data: status }))
    agent.on('PUT', '/api/ttl/set', (req) => {
      const ttl = (req.body as { ttl: number }).ttl
      status = fx.ttlStatus({ active: true, ipv6_active: true, ttl_value: ttl })
      return { data: { ttl, ipv4: true, ipv6: true } }
    })
    await openTtl(page)
    const input = page.getByLabel('TTL value')

    await input.fill('0')
    await page.getByRole('button', { name: 'Enable clamping' }).click()
    await expect(page.getByText('Enter a whole number from 1 to 255.')).toBeVisible()
    await expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(agent.mutations()).toEqual([])

    await input.fill('70')
    await page.getByRole('button', { name: 'Enable clamping' }).click()
    await expect(page.getByText('Active (TTL=70)')).toBeVisible()
    expect(agent.requests({ method: 'PUT', path: '/api/ttl/set' }).map((r) => r.body)).toEqual([{ ttl: 70 }])
    expect(agent.mutations()).toHaveLength(1)
    await expect(page.locator('[data-toast]')).toHaveCount(0)
  })

  test('Disable sends one DELETE and shows the re-read (inactive) status', async ({ page, agent }) => {
    let status = fx.ttlStatus({ active: true, ipv6_active: true, ttl_value: 64 })
    agent.on('GET', '/api/ttl/status', () => ({ data: status }))
    agent.on('DELETE', '/api/ttl/clear', () => {
      status = fx.ttlStatus()
      return { data: {} }
    })
    await openTtl(page)
    await page.getByRole('button', { name: 'Disable' }).click()
    await expect(page.getByRole('button', { name: 'Enable clamping' })).toBeVisible()
    expect(agent.requests({ method: 'DELETE', path: '/api/ttl/clear' })).toHaveLength(1)
    expect(agent.mutations()).toHaveLength(1)
  })

  test('an accepted change whose read-back fails is flagged, not silently assumed', async ({ page, agent }) => {
    agent.on('PUT', '/api/ttl/set', { data: { ttl: 70 } })
    await openTtl(page)
    await page.getByLabel('TTL value').fill('70')
    agent.fail('GET', '/api/ttl/status', { status: 503, error: 'synthetic outage' })
    await page.getByRole('button', { name: 'Enable clamping' }).click()
    await expect(page.getByText(/accepted the change, but the TTL status could not be re-read/)).toBeVisible()
    expect(agent.requests({ method: 'PUT', path: '/api/ttl/set' })).toHaveLength(1)
  })

  test('a failed set reports the error and keeps the typed value', async ({ page, agent }) => {
    agent.on('PUT', '/api/ttl/set', { error: 'synthetic set failure', status: 503 })
    await openTtl(page)
    await page.getByLabel('TTL value').fill('99')
    await page.getByRole('button', { name: 'Enable clamping' }).click()
    await expect(page.getByText('synthetic set failure')).toBeVisible()
    await expect(page.getByLabel('TTL value')).toHaveValue('99')
    expect(agent.requests({ method: 'PUT', path: '/api/ttl/set' })).toHaveLength(1)
  })
})
