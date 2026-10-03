import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { TIP_MAX_WIDTH, TIP_MARGIN, placeTooltip } from './tooltipPlacement'

// Metric help (PLAN2 U05). A focusable, named trigger whose description is
// always associated through aria-describedby (the text lives in a stable
// sr-only node); the visible box is the same text, shown:
//   - immediately on keyboard focus,
//   - after ~300 ms of mouse hover (timer cancelled on leave / unmount),
//   - on tap or click (toggles; a second tap closes).
// Escape, an outside press, scrolling and blur close it; resize re-places it.
// The box never takes focus and the pointer may move onto it.

const HOVER_DELAY_MS = 300
const LEAVE_DELAY_MS = 120

export function Tip({ text, children, className = '' }: { text: string; children: ReactNode; className?: string }) {
  const uid = useId()
  const descId = `${uid}-desc`
  const tipId = `${uid}-tip`
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLSpanElement>(null)
  const hoverTimer = useRef<number | undefined>(undefined)
  const leaveTimer = useRef<number | undefined>(undefined)
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [tick, setTick] = useState(0)

  const clearTimers = useCallback(() => {
    window.clearTimeout(hoverTimer.current)
    window.clearTimeout(leaveTimer.current)
    hoverTimer.current = undefined
    leaveTimer.current = undefined
  }, [])

  const close = useCallback(() => {
    clearTimers()
    setOpen(false)
    setPinned(false)
  }, [clearTimers])

  useEffect(() => clearTimers, [clearTimers])

  // Position after layout, from the real trigger and box sizes. Done on the DOM node so
  // a re-measure never re-renders (and the first paint is hidden until placed).
  useLayoutEffect(() => {
    if (!open) return
    const pop = popRef.current
    const trigger = triggerRef.current
    if (!pop || !trigger) return
    pop.style.maxHeight = 'none'
    pop.style.width = `${Math.min(TIP_MAX_WIDTH, window.innerWidth - 2 * TIP_MARGIN)}px`
    const p = placeTooltip(trigger.getBoundingClientRect(), pop.offsetHeight, window.innerWidth, window.innerHeight)
    pop.style.left = `${p.left}px`
    pop.style.top = `${p.top}px`
    pop.style.width = `${p.width}px`
    pop.style.maxHeight = `${p.maxHeight}px`
    pop.style.visibility = 'visible'
  }, [open, tick, text])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    const onPress = (e: PointerEvent) => {
      const t = e.target as Node | null
      if (t && (triggerRef.current?.contains(t) || popRef.current?.contains(t))) return
      close()
    }
    const onScroll = (e: Event) => {
      if (e.target instanceof Node && popRef.current?.contains(e.target)) return
      close()
    }
    const onResize = () => setTick((n) => n + 1)
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPress, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPress, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open, close])

  const scheduleClose = () => {
    window.clearTimeout(leaveTimer.current)
    leaveTimer.current = window.setTimeout(() => {
      setOpen(false)
      setPinned(false)
    }, LEAVE_DELAY_MS)
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-describedby={descId}
        aria-expanded={open}
        className={`inline-flex cursor-help items-center justify-center rounded-chip underline decoration-dotted underline-offset-2 [font:inherit] [letter-spacing:inherit] [text-transform:inherit] coarse:min-h-11 coarse:min-w-11 ${className}`}
        onPointerEnter={(e) => {
          if (e.pointerType === 'touch') return
          window.clearTimeout(leaveTimer.current)
          window.clearTimeout(hoverTimer.current)
          hoverTimer.current = window.setTimeout(() => setOpen(true), HOVER_DELAY_MS)
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === 'touch') return
          window.clearTimeout(hoverTimer.current)
          if (open && !pinned) scheduleClose()
        }}
        onFocus={() => {
          window.clearTimeout(leaveTimer.current)
          setOpen(true)
        }}
        onBlur={close}
        onClick={() => {
          if (open && pinned) close()
          else {
            clearTimers()
            setOpen(true)
            setPinned(true)
          }
        }}
      >
        {children}
      </button>
      {createPortal(
        <span id={descId} className="sr-only">
          {text}
        </span>,
        document.body,
      )}
      {open &&
        createPortal(
          <span
            ref={popRef}
            id={tipId}
            role="tooltip"
            style={{ visibility: 'hidden' }}
            className="fixed left-0 top-0 z-50 overflow-y-auto rounded-ctl border border-line/15 bg-surface px-2.5 py-1.5 text-caption leading-snug text-ink2"
            onPointerEnter={() => window.clearTimeout(leaveTimer.current)}
            onPointerLeave={() => {
              if (!pinned) scheduleClose()
            }}
          >
            {text}
          </span>,
          document.body,
        )}
    </>
  )
}
