import type { Page } from '@playwright/test'
import { test, expect, type MockAgent } from './support/harness'
import { openApp } from './support/app'
import * as fx from './support/fixtures'

// PLAN2 R07/R14/U04 — Modem > SMS. Synthetic message text and numbers only.
// Firmware tags used here: 0 received/read, 1 received/unread, 2 sent.

type Json = Record<string, unknown>

const msg = (id: number, tag: number, content: string): Json => ({
  id,
  number: `+1000000${id}`,
  content,
  date: '2026-08-08 16:42:11',
  tag,
  mem_store: 1,
})

const INBOX_UNREAD_A = msg(101, 1, 'Synthetic unread alpha')
const INBOX_UNREAD_B = msg(103, 1, 'Synthetic unread beta')
const INBOX_READ = msg(102, 0, 'Synthetic read gamma')
const SENT = msg(201, 2, 'Synthetic sent delta')
const BASE = [INBOX_UNREAD_A, INBOX_READ, INBOX_UNREAD_B, SENT]

function listWith(agent: MockAgent, messages: () => Json[]) {
  agent.on('POST', '/api/sms/list', () => ({ data: fx.smsList({ messages: messages() }) }))
}

const listRequests = (agent: MockAgent) => agent.requests({ method: 'POST', path: '/api/sms/list' })
const openSms = (page: Page) => openApp(page, { group: 'modem', tab: 'SMS' })
const message = (page: Page, text: string) => page.getByRole('button', { name: new RegExp(text) })
const box = (page: Page, name: string | RegExp) => page.getByRole('radiogroup', { name: 'Message box' }).getByRole('radio', { name })

test.describe('collection ownership', () => {
  test('a list response that started before a delete cannot resurrect the message', async ({ page, agent }) => {
    let messages = [...BASE]
    listWith(agent, () => messages)
    agent.on('POST', '/api/sms/delete', () => {
      messages = messages.filter((m) => m.id !== 102)
      return { data: {} }
    })
    await openSms(page)
    await expect(message(page, 'Synthetic read gamma')).toBeVisible()
    await message(page, 'Synthetic read gamma').click()

    // An older refresh is still in flight when the delete completes.
    const oldList = agent.defer('POST', '/api/sms/list')
    await page.getByRole('button', { name: 'Refresh messages' }).click()
    await oldList.waitForRequest()

    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await page.getByRole('dialog', { name: 'Delete this message?' }).getByRole('button', { name: 'Delete' }).click()
    await expect(message(page, 'Synthetic read gamma')).toHaveCount(0)
    await expect(page.getByText('No message selected')).toBeVisible()
    // The redundant success toast is gone; the row disappearing is the confirmation.
    await expect(page.locator('[data-toast]')).toHaveCount(0)

    // The stale response (still listing the deleted message) arrives late and is discarded.
    oldList.resolve(fx.smsList({ messages: BASE }))
    await page.waitForTimeout(150)
    await expect(message(page, 'Synthetic read gamma')).toHaveCount(0)
    await expect(message(page, 'Synthetic unread alpha')).toBeVisible()
    expect(agent.requests({ method: 'POST', path: '/api/sms/delete' }).map((r) => r.body)).toEqual([{ ids: [102] }])
  })

  test('an older list response cannot restore unread after the router acknowledged mark-read', async ({ page, agent }) => {
    listWith(agent, () => BASE)
    agent.on('POST', '/api/sms/read', { data: {} })
    await openSms(page)
    await expect(box(page, 'Inbox (2)')).toBeVisible()

    const oldList = agent.defer('POST', '/api/sms/list')
    await page.getByRole('button', { name: 'Refresh messages' }).click()
    await oldList.waitForRequest()

    await message(page, 'Synthetic unread alpha').click()
    await expect(box(page, 'Inbox (1)')).toBeVisible()
    await expect.poll(() => agent.requests({ method: 'POST', path: '/api/sms/read' }).length).toBe(1)

    oldList.resolve(fx.smsList({ messages: BASE })) // still says unread
    await page.waitForTimeout(150)
    await expect(box(page, 'Inbox (1)')).toBeVisible()
    expect(agent.requests({ method: 'POST', path: '/api/sms/read' }).map((r) => r.body)).toEqual([{ ids: [101] }])
  })

  test('a failed mark-read is rolled back to unread with an explanation', async ({ page, agent }) => {
    listWith(agent, () => BASE)
    agent.on('POST', '/api/sms/read', { error: 'synthetic read failure', status: 500 })
    await openSms(page)
    await expect(box(page, 'Inbox (2)')).toBeVisible()
    await message(page, 'Synthetic unread alpha').click()

    await expect(page.getByText(/did not mark that message as read/)).toBeVisible()
    await expect(page.getByText(/synthetic read failure/)).toBeVisible()
    await expect(box(page, 'Inbox (2)')).toBeVisible()
    await expect(message(page, 'Synthetic unread alpha').getByText('Unread', { exact: true })).toBeAttached()
    // The message itself is still readable.
    await expect(page.getByText('From: +1000000101')).toBeVisible()
    expect(agent.requests({ method: 'POST', path: '/api/sms/read' })).toHaveLength(1)
  })

  test('the unread count stays on the Inbox label while Sent is selected, and switching boxes does not re-fetch', async ({ page, agent }) => {
    listWith(agent, () => BASE)
    await openSms(page)
    await expect(box(page, 'Inbox (2)')).toBeVisible()
    expect(listRequests(agent)).toHaveLength(1)

    await box(page, 'Sent').click()
    await expect(box(page, 'Inbox (2)')).toBeVisible()
    await expect(message(page, 'Synthetic sent delta')).toBeVisible()
    await expect(message(page, 'Synthetic unread alpha')).toHaveCount(0)

    await box(page, 'Inbox (2)').click()
    await expect(message(page, 'Synthetic unread alpha')).toBeVisible()
    await expect(message(page, 'Synthetic sent delta')).toHaveCount(0)
    expect(listRequests(agent)).toHaveLength(1)
  })

  test('a selected message that disappears on refresh is deselected', async ({ page, agent }) => {
    let messages = [...BASE]
    listWith(agent, () => messages)
    await openSms(page)
    await message(page, 'Synthetic read gamma').click()
    await expect(page.getByText('From: +1000000102')).toBeVisible()

    messages = messages.filter((m) => m.id !== 102)
    await page.getByRole('button', { name: 'Refresh messages' }).click()
    await expect(message(page, 'Synthetic read gamma')).toHaveCount(0)
    await expect(page.getByText('No message selected')).toBeVisible()
  })

  test('sending refreshes the whole collection whichever box is showing', async ({ page, agent }) => {
    let messages = [...BASE]
    listWith(agent, () => messages)
    agent.on('POST', '/api/sms/send', () => {
      messages = [...messages, msg(202, 2, 'Synthetic outgoing epsilon')]
      return { data: {} }
    })
    await openSms(page)
    await page.getByRole('button', { name: 'New' }).click()
    await page.getByRole('textbox', { name: 'To' }).fill('+10000000999')
    await page.getByRole('textbox', { name: 'Message' }).fill('Synthetic outgoing epsilon')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect.poll(() => listRequests(agent).length).toBe(2)
    await box(page, 'Sent').click()
    await expect(message(page, 'Synthetic outgoing epsilon')).toBeVisible()
    expect(agent.requests({ method: 'POST', path: '/api/sms/send' }).map((r) => r.body)).toEqual([
      { number: '+10000000999', message: 'Synthetic outgoing epsilon' },
    ])
  })
})

test.describe('read failures are not "No messages"', () => {
  test('a list failure shows an error with Retry; Retry recovers', async ({ page, agent }) => {
    agent.fail('POST', '/api/sms/list', { status: 503, error: 'synthetic outage' })
    await openSms(page)
    await expect(page.getByText(/Messages could not be loaded/)).toBeVisible()
    await expect(page.getByText('No messages')).toHaveCount(0)

    listWith(agent, () => BASE)
    await page.getByRole('button', { name: 'Retry' }).click()
    await expect(message(page, 'Synthetic unread alpha')).toBeVisible()
    await expect(page.getByText(/could not be loaded/)).toHaveCount(0)
  })

  test('a refresh failure keeps the last messages, marked stale', async ({ page, agent }) => {
    listWith(agent, () => BASE)
    await openSms(page)
    await expect(message(page, 'Synthetic unread alpha')).toBeVisible()
    agent.fail('POST', '/api/sms/list', { status: 503, error: 'synthetic outage' })
    await page.getByRole('button', { name: 'Refresh messages' }).click()
    await expect(page.getByText(/Showing the last messages loaded/)).toBeVisible()
    await expect(message(page, 'Synthetic unread alpha')).toBeVisible()
    await expect(page.getByText('No messages')).toHaveCount(0)
  })

  test('a genuinely empty list is "No messages"', async ({ page, agent }) => {
    listWith(agent, () => [])
    await openSms(page)
    await expect(page.getByText('No messages')).toBeVisible()
  })

  test('the capability gate still blocks listing and offers a re-check', async ({ page, agent }) => {
    agent.on('GET', '/api/sms/capabilities', { data: fx.smsCapabilities({ ready: false, reason: 'Synthetic: modem busy' }) })
    await openSms(page)
    await expect(page.getByText('Firmware WMS is not ready')).toBeVisible()
    await expect(page.getByText('Synthetic: modem busy')).toBeVisible()
    expect(listRequests(agent)).toHaveLength(0)
    await expect(page.getByRole('button', { name: 'Check again' })).toBeVisible()
  })

  test('a capability read failure shows an error with Retry instead of a skeleton', async ({ page, agent }) => {
    agent.fail('GET', '/api/sms/capabilities', { status: 503, error: 'synthetic outage' })
    await openSms(page)
    await expect(page.getByText(/SMS availability could not be checked/)).toBeVisible()
    agent.on('GET', '/api/sms/capabilities', { data: fx.smsCapabilities() })
    listWith(agent, () => BASE)
    await page.getByRole('button', { name: 'Retry' }).click()
    await expect(message(page, 'Synthetic unread alpha')).toBeVisible()
  })
})
