// PLAN2 R11: a LAN change is confirmed before submission; Cancel sends nothing.
import { test, expect } from './support/harness'
import { openApp } from './support/app'

test('Cancel on the LAN confirmation sends nothing; Confirm sends the reviewed settings once', async ({ page, agent }) => {
  await openApp(page, { group: 'network', tab: 'Router' })
  const ip = page.getByLabel('LAN IP')
  await expect(ip).toHaveValue('192.168.0.1')
  await ip.fill('192.168.8.1')

  await page.getByRole('button', { name: 'Apply LAN' }).click()
  const dialog = page.getByRole('dialog', { name: 'Move the router to 192.168.8.1?' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('192.168.0.1 → 192.168.8.1')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toBeHidden()
  expect(agent.mutations()).toEqual([])

  // Unchanged response: the address change is not applied, so no reconnect handshake runs.
  agent.on('PUT', '/api/router/lan', { data: { changed: false } })
  await page.getByRole('button', { name: 'Apply LAN' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click()
  await expect.poll(() => agent.mutations().length).toBe(1)
  const [put] = agent.mutations()
  expect(put.method).toBe('PUT')
  expect(put.body).toMatchObject({ ipaddr: '192.168.8.1', netmask: '255.255.255.0' })
})
