/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { api } from '../data/api'
import { usePoll, type PollResult } from '../data/poll'
import type { HomeData } from '../types'
import { deriveConditions, type AlertConditions } from './alerts'

/**
 * The home poll is the app's heartbeat: one batched request that feeds the
 * Home screen, the Signal group, the Modem data tab and the global alert
 * banner. Those screens read it instead of re-fetching the same ubus data.
 *
 * `fast` is set for the groups that render live radio data; elsewhere the poll
 * only feeds the alert banner, so it idles. Changing the interval does not
 * restart the loop (see `usePoll`), so switching groups costs no extra request.
 */
const HomeContext = createContext<PollResult<HomeData> | null>(null)

export function HomeProvider({ fast, children }: { fast: boolean; children: ReactNode }) {
  const poll = usePoll('home', api.home, fast ? 3000 : 15000)
  return <HomeContext.Provider value={poll}>{children}</HomeContext.Provider>
}

export function useHome(): PollResult<HomeData> {
  const ctx = useContext(HomeContext)
  if (!ctx) throw new Error('useHome outside HomeProvider')
  return ctx
}

// ── Alerts derived from the home poll (no extra requests) ─────────────────────

export function useAlertConditions(): AlertConditions {
  const { data, error } = useHome()
  return useMemo(() => deriveConditions(data, error), [data, error])
}

