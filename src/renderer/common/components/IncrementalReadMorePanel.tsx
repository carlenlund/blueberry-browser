import type { CSSProperties, ReactElement, ReactNode } from 'react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

/** Article / discussion: a few fixed caps before full scroll. */
const HEIGHT_STEPS = [
  'max-h-[min(50vh,22rem)]',
  'max-h-[min(62vh,30rem)]',
  'max-h-[min(74vh,38rem)]',
  'max-h-[min(88vh,48rem)]',
] as const

/** Feed: same “unit” as first stepped cap — each View more multiplies by n (see `expandMode="scaled"`). */
const SCALED_BASE_VH = 50
const SCALED_BASE_REM = 22

const btnClass =
  'text-primary hover:text-primary/88 text-[12px] font-medium underline-offset-2 hover:underline'

export type IncrementalReadMoreExpandMode = 'stepped' | 'scaled'

export type ScaledStepCurve = 'linear' | 'exponential'

type IncrementalReadMorePanelProps = {
  children: ReactNode
  /** Outer wrapper (layout + padding). */
  className?: string
/**
   * `stepped` — fixed height ladder.
   * `scaled` — cap = `min(50vh,22rem) * scaledStepScale * factor` where factor is linear `(level+1)` or exponential `2^level` (see `scaledStepCurve`).
   */
  expandMode?: IncrementalReadMoreExpandMode
  /** With `scaled`: multiplier on the base step (`min(50vh,22rem)`); default 1 (feed). Use 2 for taller article/discussion steps. */
  scaledStepScale?: number
  /**
   * With `scaled`: `linear` — cap grows as `(level+1)×` base; `exponential` — cap grows as `2^level×` base per “View more”.
   */
  scaledStepCurve?: ScaledStepCurve
  /** With `scaled`: stop growing at this factor, then use unbounded scroll (default 24). */
  scaledMaxFactor?: number
}

export function IncrementalReadMorePanel({
  children,
  className = 'flex min-h-0 flex-1 flex-col py-2',
  expandMode = 'stepped',
  scaledStepScale = 1,
  scaledStepCurve = 'linear',
  scaledMaxFactor = 24,
}: IncrementalReadMorePanelProps): ReactElement {
  const [level, setLevel] = useState(0)
  const innerRef = useRef<HTMLDivElement>(null)
  const [contentOverflows, setContentOverflows] = useState(false)

  const steppedMaxLevel = HEIGHT_STEPS.length
  const isScaled = expandMode === 'scaled'
  const fullyExpanded = isScaled
    ? level >= scaledMaxFactor
    : level >= steppedMaxLevel

  const scrollClass = fullyExpanded ? 'overflow-y-auto' : 'overflow-hidden'

  const scaledVh = SCALED_BASE_VH * scaledStepScale
  const scaledRem = SCALED_BASE_REM * scaledStepScale

  const heightFactor =
    scaledStepCurve === 'exponential' ? 2 ** level : level + 1

  const innerStyle: CSSProperties | undefined =
    isScaled && !fullyExpanded
      ? {
          maxHeight: `min(calc(${scaledVh}vh * ${heightFactor}), calc(${scaledRem}rem * ${heightFactor}))`,
        }
      : undefined

  const innerClassName =
    isScaled && !fullyExpanded
      ? `relative min-h-0 ${scrollClass}`
      : `relative min-h-0 ${scrollClass} ${fullyExpanded ? 'max-h-none' : HEIGHT_STEPS[level]}`

  const updateOverflow = useCallback(() => {
    const el = innerRef.current
    if (!el || fullyExpanded) {
      setContentOverflows(false)
      return
    }
    const tol = 1
    setContentOverflows(el.scrollHeight > el.clientHeight + tol)
  }, [fullyExpanded])

  useLayoutEffect(() => {
    updateOverflow()
  }, [updateOverflow, level, children, scaledStepScale, scaledStepCurve])

  useLayoutEffect(() => {
    const el = innerRef.current
    if (!el || fullyExpanded) return

    const ro = new ResizeObserver(() => updateOverflow())
    ro.observe(el)
    const mo = new MutationObserver(() => updateOverflow())
    mo.observe(el, { childList: true, subtree: true, characterData: true })
    window.addEventListener('resize', updateOverflow)

    return () => {
      ro.disconnect()
      mo.disconnect()
      window.removeEventListener('resize', updateOverflow)
    }
  }, [fullyExpanded, updateOverflow, level])

  /** Images (and similar) can change layout after load without resizing the clip box. */
  useEffect(() => {
    const el = innerRef.current
    if (!el || fullyExpanded) return
    const onLoadCapture = () => updateOverflow()
    el.addEventListener('load', onLoadCapture, true)
    return () => el.removeEventListener('load', onLoadCapture, true)
  }, [fullyExpanded, updateOverflow, level])

  const showExpandUi = !fullyExpanded && contentOverflows

  return (
    <div className={className}>
      <div ref={innerRef} className={innerClassName} style={innerStyle}>
        {children}
        {showExpandUi ? (
          <div
            className="from-background pointer-events-none absolute bottom-0 left-0 right-0 h-10 bg-gradient-to-t to-transparent"
            aria-hidden
          />
        ) : null}
      </div>
      {showExpandUi ? (
        <div className="text-primary mt-2">
          <button
            type="button"
            className={btnClass}
            onClick={() =>
              setLevel((l) =>
                isScaled
                  ? Math.min(l + 1, scaledMaxFactor)
                  : Math.min(l + 1, steppedMaxLevel),
              )
            }
          >
            View more
          </button>
        </div>
      ) : null}
    </div>
  )
}
