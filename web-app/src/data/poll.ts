import { useCallback, useEffect, useRef, useState } from 'react'
import { PollScheduler, resourceStatus, type ResourceStatus } from './pollScheduler'

export { resourceStatus, type ResourceStatus }

const cache = new Map<string, unknown>()

/** Forget every cached reading (SMS, settings…) when the session ends. */
export function clearPollCache() {
  cache.clear()
}

export interface PollResult<T> {
  data: T | null
  error: string | null
  status: ResourceStatus
  /** A refresh() is in flight (initial loads report `status: 'loading'` instead). */
  refreshing: boolean
  /** Re-read now; older in-flight results are discarded. Doubles as "Retry". */
  refresh: () => void
  /** Publish an authoritative value (e.g. a mutation's reply); older reads are discarded. */
  mutate: (value: T) => void
}

/**
 * Own one resource's reads. With a number `intervalMs` it polls; with `null`
 * it reads once (and on refresh()). `key` must include every parameter that
 * changes the result: on a key change the hook shows that key's cached value
 * (or loading) immediately, never the previous key's data or error.
 */
export function usePoll<T>(
  key: string,
  fn: () => Promise<T>,
  intervalMs: number | null,
  enabled = true,
): PollResult<T> {
  const [owner, setOwner] = useState(key)
  const [data, setData] = useState<T | null>(() => (cache.get(key) as T | undefined) ?? null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const fnRef = useRef(fn)
  const intervalRef = useRef(intervalMs)
  const scheduler = useRef<PollScheduler<T> | null>(null)

  if (owner !== key) {
    // Adjusting state during render: React discards this render and re-runs it.
    setOwner(key)
    setData((cache.get(key) as T | undefined) ?? null)
    setError(null)
    setRefreshing(false)
  }

  useEffect(() => {
    fnRef.current = fn
    intervalRef.current = intervalMs
  })

  useEffect(() => {
    if (!enabled) return
    const poll = new PollScheduler<T>({
      read: () => fnRef.current(),
      publish: (value) => {
        cache.set(key, value)
        setData(value)
        setError(null)
      },
      error: setError,
      refreshing: setRefreshing,
      interval: () => intervalRef.current,
      visible: () => !document.hidden,
    })
    scheduler.current = poll
    const onVisibility = () => poll.wake()
    document.addEventListener('visibilitychange', onVisibility)
    poll.start()
    return () => {
      poll.stop()
      scheduler.current = null
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [key, enabled])

  const refresh = useCallback(() => scheduler.current?.refresh(), [])
  const mutate = useCallback((value: T) => scheduler.current?.mutate(value), [])
  return { data, error, status: resourceStatus(data, error), refreshing, refresh, mutate }
}

/** A one-shot read with the same ownership, retry and stale semantics as a poll. */
export function useResource<T>(key: string, fn: () => Promise<T>, enabled = true): PollResult<T> {
  return usePoll(key, fn, null, enabled)
}
