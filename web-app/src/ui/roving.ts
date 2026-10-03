/** Shared roving-focus key handling for Tabs and Segmented (wrapping Left/Right, Home/End). */
export function rovingTarget(
  key: string,
  index: number,
  count: number,
  isEnabled: (i: number) => boolean = () => true,
): number | null {
  if (count === 0) return null
  const step = key === 'ArrowRight' || key === 'ArrowDown' ? 1 : key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 0
  let next: number
  if (step !== 0) {
    next = index
    for (let n = 0; n < count; n++) {
      next = (next + step + count) % count
      if (isEnabled(next)) return next
    }
    return null
  }
  if (key === 'Home') {
    for (let i = 0; i < count; i++) if (isEnabled(i)) return i
  } else if (key === 'End') {
    for (let i = count - 1; i >= 0; i--) if (isEnabled(i)) return i
  }
  return null
}
