/* eslint-disable react-refresh/only-export-components */
import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react'
import { IChevronDown } from '../icons'
import { Spinner } from './primitives'
import { rovingTarget } from './roving'

// ── Buttons ───────────────────────────────────────────────────────────────────

type ButtonVariant = 'primary' | 'subtle' | 'ghost' | 'danger' | 'outline'

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-onaccent hover:brightness-110 active:brightness-95',
  subtle: 'border border-line/12 bg-surface text-ink hover:bg-surface2 active:bg-line/10',
  ghost: 'text-ink2 hover:bg-surface2 hover:text-ink',
  danger: 'bg-danger text-onaccent hover:brightness-110 active:brightness-95',
  outline: 'border border-line/15 text-ink hover:border-accent/50 hover:bg-surface2',
}

/** Compact on fine pointers (32/36 px); ≥44 × 44 on coarse pointers (design.md § Touch targets). */
export function Button({
  variant = 'subtle',
  size = 'md',
  loading = false,
  className = '',
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: 'sm' | 'md'
  loading?: boolean
}) {
  const sizing = size === 'sm' ? 'h-8 px-3 text-meta' : 'h-9 px-3.5 text-body'
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-ctl font-semibold transition-[background-color,border-color,filter,opacity] coarse:min-h-11 coarse:min-w-11 disabled:pointer-events-none disabled:opacity-45 ${sizing} ${BUTTON_VARIANTS[variant]} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Spinner size={13} />}
      {children}
    </button>
  )
}

// ── Toggle (switch) ───────────────────────────────────────────────────────────

/**
 * Switch. **An accessible name is required in practice**: pass `label` (a string naming the thing
 * being switched, e.g. "Hidden SSID") or `labelledBy` (id of a visible label). A switch with neither
 * is announced as an anonymous "switch".
 *
 * The visible track stays 24 × 40; on coarse pointers the button grows to a 44 × 44 hit area around it.
 */
export function Toggle({
  checked,
  onChange,
  disabled = false,
  label,
  labelledBy,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  /** Accessible name. Required unless `labelledBy` is given. */
  label?: string
  /** Id of an element that names this switch. */
  labelledBy?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="group relative inline-flex h-6 w-10 shrink-0 items-center justify-center outline-none coarse:h-11 coarse:w-11 disabled:opacity-40"
    >
      <span
        className={`relative inline-flex h-6 w-10 items-center rounded-full transition-colors group-focus-visible:outline group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-accent ${
          checked ? 'bg-accent' : 'bg-line/20'
        }`}
      >
        <span
          className={`inline-block h-[18px] w-[18px] transform rounded-full bg-onaccent shadow-sm transition-transform ${
            checked ? 'translate-x-[21px]' : 'translate-x-[3px]'
          }`}
        />
      </span>
    </button>
  )
}

// ── Toggle chip (multi-select) ────────────────────────────────────────────────

/**
 * Multi-select chip button (e.g. band selection): a real `<button aria-pressed>`. Selection is
 * announced by `aria-pressed` and `disabled` — not only by fill colour: pressed also gets a heavier
 * border and a leading check. Use `Segmented` for exclusive choices.
 */
export function ToggleChip({
  pressed,
  tone = 'accent',
  className = '',
  children,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-pressed'> & {
  pressed: boolean
  /** Colour family of the pressed state; `nr` for 5G NR bands. */
  tone?: 'accent' | 'nr'
}) {
  const on =
    tone === 'nr'
      ? 'border-nr bg-nr/10 text-nr'
      : 'border-accent bg-accent/10 text-accent'
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={`inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-chip border px-2.5 py-1 font-mono text-meta transition-colors coarse:min-h-11 coarse:min-w-11 disabled:pointer-events-none disabled:opacity-45 ${
        pressed ? `${on} font-semibold` : 'border-line/12 font-medium text-ink2 hover:border-line/25 hover:text-ink'
      } ${className}`}
      {...props}
    >
      {pressed && (
        <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m4.5 12.5 5 5L19.5 7" />
        </svg>
      )}
      {children}
    </button>
  )
}

// ── Form fields ───────────────────────────────────────────────────────────────

// No `outline-none`: keyboard focus uses the global 2 px accent ring (design.md § Focus). The border
// change on focus is a secondary cue only.
const CONTROL_CLS =
  'h-9 w-full rounded-ctl border border-line/15 bg-surface px-3 text-body text-ink transition-colors placeholder:text-ink3 focus:border-accent disabled:opacity-50'

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  const { className = '', ...rest } = props
  return <input className={`${CONTROL_CLS} ${className}`} {...rest} />
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  const { className = '', ...rest } = props
  return (
    <span className="relative block w-full">
      <select className={`${CONTROL_CLS} appearance-none pr-8 ${className}`} {...rest} />
      <IChevronDown
        size={14}
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink3"
      />
    </span>
  )
}

/** Ids for wiring a custom control (range, number input…) to a `Field`'s label, hint and error. */
export interface FieldIds {
  /** Put on the control (`id`). The label's `htmlFor` points here. */
  id: string
  /** Id of the visible label element (for `aria-labelledby`). */
  labelId: string
  hintId: string
  errorId: string
  /** Pass to the control as `aria-describedby` (undefined when there is no hint/error). */
  describedBy: string | undefined
  /** Pass to the control as `aria-invalid`. */
  invalid: boolean
}

/** Stable generated ids for a field, for callers that lay out their own label/hint/error. */
export function useFieldIds(opts: { hint?: boolean; error?: boolean } = {}): FieldIds {
  const base = useId()
  const hintId = `${base}-hint`
  const errorId = `${base}-error`
  const describedBy = [opts.hint ? hintId : null, opts.error ? errorId : null].filter(Boolean).join(' ') || undefined
  return { id: `${base}-control`, labelId: `${base}-label`, hintId, errorId, describedBy, invalid: !!opts.error }
}

function isNativeControl(child: ReactNode): child is ReactElement<Record<string, unknown>> {
  return isValidElement(child) && (child.type === Input || child.type === Select || child.type === 'input' || child.type === 'select' || child.type === 'textarea')
}

/**
 * Labelled form field.
 *
 * - Plain children (`<Input/>`, `<Select/>`, `<textarea/>`): the label wraps the control (click-to-focus),
 *   and `hint` / `error` are linked to the control with `aria-describedby` automatically.
 * - Children as a function `(ids: FieldIds) => ReactNode`: for ranges, number inputs and other custom
 *   controls. The label gets `htmlFor={ids.id}`; the caller must put `ids.id`, `ids.describedBy` and
 *   `ids.invalid` on the control. Use `id` to supply your own control id instead of a generated one.
 * - `error` is text in `text-danger`, not a live region (see design.md § Feedback).
 */
export function Field({
  label,
  children,
  hint,
  error,
  id,
}: {
  label: string
  children: ReactNode | ((ids: FieldIds) => ReactNode)
  hint?: string
  error?: string
  /** Explicit control id for the render-prop form. */
  id?: string
}) {
  const ids = useFieldIds({ hint: !!hint, error: !!error })
  const controlId = id ?? ids.id
  const notes = (
    <>
      {hint && (
        <span id={ids.hintId} className="mt-1 block text-caption text-ink3">
          {hint}
        </span>
      )}
      {error && (
        <span id={ids.errorId} className="mt-1 block text-caption font-medium text-danger">
          {error}
        </span>
      )}
    </>
  )

  if (typeof children === 'function') {
    return (
      <div className="block">
        <label id={ids.labelId} htmlFor={controlId} className="label mb-1 block">
          {label}
        </label>
        {children({ ...ids, id: controlId })}
        {notes}
      </div>
    )
  }

  let content = children
  const only = Children.count(children) === 1 ? Children.toArray(children)[0] : null
  if (isNativeControl(only) && (hint || error)) {
    content = cloneElement(only, {
      'aria-describedby': [only.props['aria-describedby'], ids.describedBy].filter(Boolean).join(' ') || undefined,
      'aria-invalid': error ? true : only.props['aria-invalid'],
    })
  }

  return (
    <div className="block">
      <label className="block">
        <span className="label mb-1 block">{label}</span>
        {content}
      </label>
      {notes}
    </div>
  )
}

// ── Segmented control ─────────────────────────────────────────────────────────

/**
 * Exclusive choice as a named radio group (`role="radiogroup"` + `role="radio"` items, roving tab stop).
 *
 * Keyboard (default, `activation="auto"`): arrows move selection and call `onChange`, exactly like
 * native radios. **Device-changing consumers must not submit from `onChange`.** Keep a draft value in
 * state and commit it with an explicit Apply button (or separate action buttons with a confirm).
 * Pass `activation="manual"` if arrows should only move focus and Space/Enter should select.
 *
 * Always pass `label` (or `labelledBy`): an unnamed radio group is announced without context.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  disabled = false,
  label,
  labelledBy,
  activation = 'auto',
  wrap = false,
}: {
  options: { value: T; label: string; disabled?: boolean }[]
  value: T
  onChange: (v: T) => void
  disabled?: boolean
  /** Accessible name of the group (e.g. "Theme"). */
  label?: string
  labelledBy?: string
  /** `auto`: arrows select (native radio behaviour). `manual`: arrows only move focus. */
  activation?: 'auto' | 'manual'
  /** Let options flow onto several lines (many options on a phone). */
  wrap?: boolean
}) {
  const refs = useRef(new Map<string, HTMLButtonElement>())
  const [focusValue, setFocusValue] = useState<T>(value)
  const [lastValue, setLastValue] = useState<T>(value)
  if (lastValue !== value) {
    setLastValue(value)
    setFocusValue(value)
  }
  const enabled = (i: number) => !options[i].disabled
  const selectedIdx = options.findIndex((o) => o.value === value)
  const focusIdx = options.findIndex((o) => o.value === focusValue)
  const stopIdx = focusIdx >= 0 ? focusIdx : selectedIdx >= 0 ? selectedIdx : Math.max(options.findIndex((_, i) => enabled(i)), 0)

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (disabled || e.altKey || e.ctrlKey || e.metaKey) return
    const next = rovingTarget(e.key, stopIdx, options.length, enabled)
    if (next == null) return
    e.preventDefault()
    const o = options[next]
    setFocusValue(o.value)
    refs.current.get(o.value)?.focus()
    if (activation === 'auto' && o.value !== value) onChange(o.value)
  }

  return (
    <div
      role="radiogroup"
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      aria-disabled={disabled || undefined}
      onKeyDown={onKeyDown}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusValue(value)
      }}
      className={`${wrap ? 'flex flex-wrap gap-0.5' : 'inline-flex'} rounded-ctl border border-line/12 bg-surface2 p-0.5 ${disabled ? 'opacity-50' : ''}`}
    >
      {options.map((o, i) => {
        const checked = value === o.value
        return (
          <button
            key={o.value}
            ref={(el) => {
              if (el) refs.current.set(o.value, el)
              else refs.current.delete(o.value)
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={i === stopIdx ? 0 : -1}
            disabled={disabled || o.disabled}
            onFocus={() => setFocusValue(o.value)}
            onClick={() => onChange(o.value)}
            className={`whitespace-nowrap rounded-chip px-3 py-1.5 text-meta font-semibold transition-colors coarse:min-h-11 coarse:min-w-11 ${
              checked ? 'bg-surface text-ink ring-1 ring-line/12' : 'text-ink2 hover:text-ink'
            } ${o.disabled ? 'opacity-50' : ''}`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
