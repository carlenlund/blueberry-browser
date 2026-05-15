import { useEffect, useRef } from 'react'

import {
  BLUEBERRY_LOGO_PATH_D,
  BLUEBERRY_LOGO_VIEWBOX,
  BLUEBERRY_LOGO_LOADING_FILL_DARK,
  BLUEBERRY_LOGO_LOADING_FILL_LIGHT,
} from '@shared/logoPaths'

type LogoPathMeta = { cx: number; cy: number; el: SVGPathElement }

export function FeedOverlayLoading({ isDark }: { isDark: boolean }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const fill = isDark
    ? BLUEBERRY_LOGO_LOADING_FILL_DARK
    : BLUEBERRY_LOGO_LOADING_FILL_LIGHT

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const pathEls = Array.from(svg.querySelectorAll('path')) as SVGPathElement[]
    const meta: LogoPathMeta[] = pathEls.map((p) => {
      const b = p.getBBox()
      return { cx: b.x + b.width * 0.5, cy: b.y + b.height * 0.5, el: p }
    })
    const order = meta
      .map((_, i) => i)
      .sort((ia, ib) => {
        const a = meta[ia]!
        const b = meta[ib]!
        const ay = Math.round(a.cy)
        const by = Math.round(b.cy)
        if (ay !== by) return ay - by
        return a.cx - b.cx
      })
    const perPath = 0.42
    const t0 = performance.now()
    let raf = 0
    const tick = (now: number): void => {
      const t = (now - t0) * 0.001
      const n = order.length
      const cycle = perPath * n
      const tRel = cycle > 0 ? t % cycle : 0
      const slot = n > 0 ? Math.min(Math.floor(tRel / perPath), n - 1) : 0
      const localT = n > 0 ? (tRel - slot * perPath) / perPath : 0
      const activeIdx = n > 0 ? order[slot]! : -1
      for (let j = 0; j < meta.length; j++) {
        const m = meta[j]!
        if (j !== activeIdx) {
          m.el.removeAttribute('transform')
        } else {
          const s = 1 - 0.14 * Math.sin(Math.PI * localT)
          m.el.setAttribute(
            'transform',
            `translate(${m.cx},${m.cy}) scale(${s}) translate(${-m.cx},${-m.cy})`,
          )
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const vbW = BLUEBERRY_LOGO_VIEWBOX.w
  const vbH = BLUEBERRY_LOGO_VIEWBOX.h
  const svgPx = 56

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-3">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${vbW} ${vbH}`}
        width={svgPx}
        height={(svgPx * vbH) / vbW}
        fill="none"
        className="overflow-visible"
        aria-hidden
      >
        {BLUEBERRY_LOGO_PATH_D.map((d, i) => (
          <path key={i} d={d} fill={fill} />
        ))}
      </svg>
    </div>
  )
}
