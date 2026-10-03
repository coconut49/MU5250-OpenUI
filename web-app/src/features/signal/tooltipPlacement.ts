// Tooltip geometry (PLAN2 U05). Pure so it can be unit-tested: the box's real
// left edge (centre - width / 2) is clamped to the viewport margins, the width
// is capped at narrow viewports, and the box flips above/below by available space.

export const TIP_MARGIN = 8
export const TIP_GAP = 8
export const TIP_MAX_WIDTH = 224

export interface TipRect {
  left: number
  right: number
  top: number
  bottom: number
}

export interface TipPlacement {
  left: number
  top: number
  width: number
  /** Room on the chosen side; the box scrolls internally if its text is taller. */
  maxHeight: number
  side: 'above' | 'below'
}

export function placeTooltip(trigger: TipRect, tipHeight: number, vw: number, vh: number): TipPlacement {
  const width = Math.max(0, Math.min(TIP_MAX_WIDTH, vw - 2 * TIP_MARGIN))
  const centre = (trigger.left + trigger.right) / 2
  const left = Math.min(Math.max(centre - width / 2, TIP_MARGIN), Math.max(TIP_MARGIN, vw - TIP_MARGIN - width))
  const above = Math.max(0, trigger.top - TIP_GAP - TIP_MARGIN)
  const below = Math.max(0, vh - trigger.bottom - TIP_GAP - TIP_MARGIN)
  let side: 'above' | 'below'
  if (tipHeight <= above) side = 'above'
  else if (tipHeight <= below) side = 'below'
  else side = above >= below ? 'above' : 'below'
  const maxHeight = side === 'above' ? above : below
  const height = Math.min(tipHeight, maxHeight)
  const top = side === 'above' ? trigger.top - TIP_GAP - height : trigger.bottom + TIP_GAP
  return { left, top, width, maxHeight, side }
}
