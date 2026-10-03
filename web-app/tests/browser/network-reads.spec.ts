import type { Locator, Page } from '@playwright/test'
import { test, expect, type MockAgent } from './support/harness'
import { openApp, VIEWPORTS } from './support/app'
import * as fx from './support/fixtures'

/**
 * Network group read states (R07), stacked mobile rows (U07) and 320 px layout.
 * Everything is answered by the synthetic agent.
 */

/** The DOM carries both the stacked list and the desktop table; only one is displayed per viewport. */
const shown = (l: Locator) => l.locator('visible=true').first()

const CLIENTS = '/api/network/clients'
const USB = '/api/usb/status'

// Synthetic, deliberately awkward: long hostnames, IPv6, wide MACs and high rates.
const LONG_HOST = 'synthetic-workstation-with-a-very-long-hostname-for-wrapping-checks.example.invalid'
const awkwardClients = () =>
  fx.clients({
    clients: [
      { mac: '02:00:5E:00:00:01', ip: '2001:db8:85a3:0:0:8a2e:370:7334', hostname: LONG_HOST, medium: 'wifi', wifi_band: '5 GHz', signal_dbm: -42, tx_bitrate_mbps: 2401.9, rx_bitrate_mbps: 2401.9 },
      { mac: '02:00:5E:00:00:02', ip: '192.168.0.102', hostname: 'synthetic-phone', medium: 'wifi', wifi_band: '2.4 GHz', signal_dbm: -67, tx_bitrate_mbps: 144.4, rx_bitrate_mbps: 115.6 },
      { mac: '02:00:5E:00:00:03', ip: '2001:db8:85a3:0:0:8a2e:370:7335', hostname: LONG_HOST, medium: 'usb-c', interface: 'ncm0' },
      { mac: '02:00:5E:00:00:04', ip: '192.168.0.104', hostname: 'synthetic-dock', medium: 'ethernet', wired_link_mbps: 2500 },
      { mac: '02:00:5E:00:00:05', ip: '192.168.0.105', hostname: 'synthetic-printer', medium: 'wired' },
      { mac: '02:00:5E:00:00:06', ip: '192.168.0.106', medium: 'bluetooth' },
    ],
  })

async function openClients(page: Page, agent: MockAgent, withAwkward = false) {
  if (withAwkward) agent.on('GET', CLIENTS, { data: awkwardClients() })
  await openApp(page, { group: 'network', tab: 'Clients' })
}

test.describe('Clients (R07)', () => {
  test('first-load failure ends loading with an error, and Retry recovers', async ({ page, agent }) => {
    agent.fail('GET', CLIENTS, { times: 1, error: 'iw dump failed' })
    await openApp(page, { group: 'network', tab: 'Clients' })
    const alert = page.getByRole('alert').filter({ hasText: 'Could not read the connected clients' })
    await expect(alert).toContainText('iw dump failed')
    await expect(page.getByText('No clients connected')).toHaveCount(0)
    await alert.getByRole('button', { name: 'Retry' }).click()
    await expect(page.getByText('Connected clients (3)')).toBeVisible()
  })

  test('a failed refresh keeps the last list and count, marked stale', async ({ page, agent }) => {
    await openClients(page, agent)
    await expect(page.getByText('Connected clients (3)')).toBeVisible()
    agent.fail('GET', CLIENTS, { error: 'iw dump failed' })
    await page.getByRole('button', { name: 'Refresh' }).click()
    await expect(page.getByText(/Showing the last client list that loaded.*iw dump failed/)).toBeVisible()
    await expect(page.getByText('Connected clients (3)')).toBeVisible()
    await expect(shown(page.getByText('synthetic-laptop'))).toBeVisible()
    await expect(page.getByText('No clients connected')).toHaveCount(0)
    agent.on('GET', CLIENTS, { data: fx.clients() })
    await page.getByRole('button', { name: 'Retry' }).click()
    await expect(page.getByText(/Showing the last client list/)).toHaveCount(0)
  })

  test('a successful empty list says so; a failed first read does not', async ({ page, agent }) => {
    agent.on('GET', CLIENTS, { data: fx.clients({ clients: [] }) })
    await openApp(page, { group: 'network', tab: 'Clients' })
    await expect(page.getByText('No clients connected', { exact: true })).toBeVisible()
  })

  test('a USB-status failure is reported on the USB card and does not hide the clients', async ({ page, agent }) => {
    agent.fail('GET', USB, { error: 'usb ubus busy' })
    await openClients(page, agent)
    await expect(page.getByText('Connected clients (3)')).toBeVisible()
    await expect(shown(page.getByText('synthetic-laptop'))).toBeVisible()
    const usbAlert = page.getByRole('alert').filter({ hasText: 'USB link details are unavailable' })
    await expect(usbAlert).toContainText('usb ubus busy')
    await expect(page.getByText('Showing the last client list')).toHaveCount(0)
    await expect(shown(page.getByText('synthetic-usb-host'))).toBeVisible()
    agent.on('GET', USB, { data: fx.usbStatus() })
    await usbAlert.getByRole('button', { name: 'Retry' }).click()
    await expect(page.getByText('Tether link')).toBeVisible()
    await expect(usbAlert).toHaveCount(0)
  })

  test('a clients failure does not hide a healthy USB link', async ({ page, agent }) => {
    await openClients(page, agent)
    await expect(page.getByText('Tether link')).toBeVisible()
    agent.fail('GET', CLIENTS)
    await page.getByRole('button', { name: 'Refresh' }).click()
    await expect(page.getByText(/Showing the last client list/)).toBeVisible()
    await expect(page.getByText('Tether link')).toBeVisible()
    await expect(page.getByText(/USB link details are unavailable/)).toHaveCount(0)
  })
})

test.describe('Router (R07)', () => {
  test('a failed DNS read shows an error, no plausible defaults, and disables Apply', async ({ page, agent }) => {
    agent.fail('GET', '/api/router/dns', { error: 'uci show failed' })
    agent.on('PUT', '/api/router/dns', { data: {} })
    await openApp(page, { group: 'network', tab: 'Router' })
    const alert = page.getByRole('alert').filter({ hasText: 'Could not read the DNS settings' })
    await expect(alert).toContainText('uci show failed')
    const apply = page.getByRole('button', { name: 'Apply DNS' })
    await expect(apply).toBeDisabled()
    for (const name of ['Primary DNS (IPv4)', 'Secondary DNS (IPv4)', 'Primary DNS (IPv6)', 'Secondary DNS (IPv6)']) {
      const input = page.getByRole('textbox', { name })
      await expect(input).toBeDisabled()
      await expect(input).toHaveValue('')
    }
    await expect(page.getByRole('button', { name: 'Fill Cloudflare DNS servers' })).toBeDisabled()
    // The LAN card is independent and stays usable.
    await expect(page.getByRole('button', { name: 'Apply LAN' })).toBeEnabled()
    expect(agent.mutations()).toEqual([])

    agent.on('GET', '/api/router/dns', { data: fx.dns() })
    await alert.getByRole('button', { name: 'Retry' }).click()
    await expect(page.getByRole('textbox', { name: 'Primary DNS (IPv4)' })).toHaveValue('192.0.2.1')
    await expect(apply).toBeEnabled()
    await expect(alert).toHaveCount(0)
  })

  test('a failed LAN read disables Apply and shows no default address', async ({ page, agent }) => {
    agent.fail('GET', '/api/router/lan', { error: 'uci show failed' })
    await openApp(page, { group: 'network', tab: 'Router' })
    await expect(page.getByRole('alert').filter({ hasText: 'Could not read the LAN settings' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Apply LAN' })).toBeDisabled()
    await expect(page.getByRole('textbox', { name: 'LAN IP' })).toHaveValue('')
    await expect(page.getByRole('textbox', { name: 'LAN IP' })).toBeDisabled()
    await expect(page.getByRole('switch', { name: 'DHCP server' })).toBeDisabled()
    expect(agent.mutations()).toEqual([])
  })

  test('a healthy read fills the form, and an edit followed by Apply sends the edited values', async ({ page, agent }) => {
    agent.on('PUT', '/api/router/dns', { data: {} })
    await openApp(page, { group: 'network', tab: 'Router' })
    await page.getByRole('button', { name: 'Fill Quad9 DNS servers' }).click()
    agent.on('GET', '/api/router/dns', { data: fx.dns({ prefer_dns_manual: '9.9.9.9' }) })
    await page.getByRole('button', { name: 'Apply DNS' }).click()
    await expect.poll(() => agent.requests({ method: 'PUT', path: '/api/router/dns' }).length).toBe(1)
    expect(agent.requests({ method: 'PUT', path: '/api/router/dns' })[0].body).toMatchObject({ dns_mode: 'manual', prefer_dns_manual: '9.9.9.9', standby_dns_manual: '149.112.112.112' })
    await expect(page.getByRole('textbox', { name: 'Primary DNS (IPv4)' })).toHaveValue('9.9.9.9')
  })
})

test.describe('stacked client rows below sm (U07)', () => {
  test.use({ viewport: VIEWPORTS.phone375, hasTouch: true, isMobile: true })

  test('USB, Ethernet and Other rows keep hostname, IP, interface, MAC and rates', async ({ page, agent }) => {
    await openClients(page, agent, true)
    const usb = page.locator('section').filter({ has: page.getByRole('heading', { name: 'USB-C (1)' }) })
    await expect(shown(usb.getByText(LONG_HOST))).toBeVisible()
    await expect(shown(usb.getByText('2001:db8:85a3:0:0:8a2e:370:7335'))).toBeVisible()
    await expect(shown(usb.getByText('ncm0'))).toBeVisible()
    await expect(shown(usb.getByText('02:00:5E:00:00:03'))).toBeVisible()
    await expect(usb.getByRole('table')).toBeHidden()

    const eth = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Ethernet (1)' }) })
    await expect(shown(eth.getByText('synthetic-dock'))).toBeVisible()
    await expect(shown(eth.getByText('2500 Mbps'))).toBeVisible()
    await expect(shown(eth.getByText('02:00:5E:00:00:04'))).toBeVisible()

    const other = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Other (2)' }) })
    await expect(shown(other.getByText('synthetic-printer'))).toBeVisible()
    await expect(shown(other.getByText('02:00:5E:00:00:05'))).toBeVisible()
    // Unknown medium is still listed, and a missing hostname is announced as such.
    await expect(shown(other.getByText('02:00:5E:00:00:06'))).toBeVisible()
    await expect(other.getByText('No hostname').first()).toBeAttached()

    const wifi = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Wi-Fi (2)' }) })
    await expect(shown(wifi.getByText('TX 2402 / RX 2402 Mbps'))).toBeVisible()
  })
})

test.describe('no horizontal overflow at 320 px', () => {
  test.use({ viewport: VIEWPORTS.phone320, hasTouch: true, isMobile: true })

  async function overflow(page: Page) {
    await page.waitForLoadState('networkidle')
    return page.evaluate(() => {
      const vw = document.documentElement.clientWidth
      const main = document.querySelector('main')!
      const out: string[] = []
      if (main.scrollWidth > main.clientWidth + 1) out.push(`main scrollWidth ${main.scrollWidth} > ${main.clientWidth}`)
      // No scroller exemption: on a phone every row is stacked, nothing may need sideways scrolling.
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) continue
        if (r.right > vw + 1 || r.left < -1) {
          out.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} ${Math.round(r.left)}..${Math.round(r.right)}`)
          if (out.length > 8) break
        }
      }
      return out
    })
  }

  test('Clients with long hostnames, IPv6 and the USB cable/port chip', async ({ page, agent }) => {
    await openClients(page, agent, true)
    await expect(page.getByText('cable/port limiting')).toBeVisible()
    expect(await overflow(page)).toEqual([])
  })

  test('Wi-Fi, in view and edit mode with awkward values', async ({ page, agent }) => {
    agent.on('GET', '/api/wifi/status', { data: fx.wifiStatus({ ssid_2g: 'S'.repeat(32), ssid_5g: 'Synthetic-WiFi-with-a-long-5GHz-name', key_2g: 'p'.repeat(40), guest_ssid: 'G'.repeat(32) }) })
    await openApp(page, { group: 'network', tab: 'Wi-Fi' })
    await expect(page.getByText('Master switch')).toBeVisible()
    expect(await overflow(page)).toEqual([])
    await page.getByRole('button', { name: 'Edit 2.4 GHz settings' }).click()
    await page.getByRole('button', { name: 'Edit 5 GHz settings' }).click()
    await page.getByRole('textbox', { name: 'TX power (%)' }).first().fill('12.5')
    expect(await overflow(page)).toEqual([])
  })

  test('Router with a read failure and with healthy data', async ({ page, agent }) => {
    agent.fail('GET', '/api/router/dns', { error: 'uci show failed with a rather long explanatory message for narrow screens' })
    await openApp(page, { group: 'network', tab: 'Router' })
    await expect(page.getByRole('alert').filter({ hasText: 'Could not read the DNS settings' })).toBeVisible()
    expect(await overflow(page)).toEqual([])
    agent.on('GET', '/api/router/dns', { data: fx.dns({ ipv6_wan_prefer_dns_manual: '2001:db8:85a3:0:0:8a2e:370:7334' }) })
    await page.getByRole('button', { name: 'Retry' }).click()
    await expect(page.getByRole('textbox', { name: 'Primary DNS (IPv4)' })).toBeEnabled()
    expect(await overflow(page)).toEqual([])
  })
})
