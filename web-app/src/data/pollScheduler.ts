/**
 * - `loading`: no data yet and no failure (first read pending, or disabled).
 * - `ready`: the last read succeeded (the data may be a genuinely empty list).
 * - `error`: the first read failed; there is nothing to show.
 * - `stale`: a later read failed; `data` is the last good value.
 */
export type ResourceStatus = 'loading' | 'ready' | 'error' | 'stale'

export function resourceStatus(data: unknown, error: string | null): ResourceStatus {
  if (error != null) return data == null ? 'error' : 'stale'
  return data == null ? 'loading' : 'ready'
}

interface PollOptions<T> {
  read: () => Promise<T>
  publish: (value: T) => void
  error: (message: string) => void
  refreshing: (value: boolean) => void
  /** Delay before the next read; `null` reads once and then only on refresh(). */
  interval: () => number | null
  visible: () => boolean
}

/** One owner for a poll's request and timer. Mutations invalidate older reads. */
export class PollScheduler<T> {
  private active = false
  private busy = false
  private revision = 0
  private pendingRefresh = false
  /** A one-shot resource (interval `null`) still owes a read. */
  private due = true
  private timer: ReturnType<typeof setTimeout> | undefined

  private readonly options: PollOptions<T>

  constructor(options: PollOptions<T>) { this.options = options }

  start() {
    this.active = true
    this.due = true
    this.wake()
  }

  stop() {
    this.active = false
    this.revision++
    this.pendingRefresh = false
    clearTimeout(this.timer)
  }

  wake() {
    clearTimeout(this.timer)
    if (!this.active || !this.options.visible() || this.busy) return
    // Returning to the page re-reads a poll, but not a one-shot read that already ran.
    if (this.options.interval() == null && !this.due) return
    void this.run()
  }

  refresh() {
    if (!this.active) return
    this.revision++
    this.pendingRefresh = true
    this.due = true
    this.options.refreshing(true)
    this.wake()
  }

  mutate(value: T) {
    if (!this.active) return
    this.revision++
    this.options.publish(value)
  }

  private async run() {
    if (!this.active || this.busy || !this.options.visible()) return
    this.busy = true
    this.pendingRefresh = false
    this.due = false
    const revision = this.revision
    try {
      const value = await this.options.read()
      if (this.active && revision === this.revision) this.options.publish(value)
    } catch (error) {
      if (this.active && revision === this.revision) {
        this.options.error(error instanceof Error ? error.message : String(error))
      }
    } finally {
      this.busy = false
      if (this.active) {
        if (!this.pendingRefresh) this.options.refreshing(false)
        const delay = this.pendingRefresh ? 0 : this.options.interval()
        if (delay != null && this.options.visible()) {
          // Visibility changes never create a second owner while read() is pending.
          this.timer = setTimeout(() => void this.run(), delay)
        }
      }
    }
  }
}
