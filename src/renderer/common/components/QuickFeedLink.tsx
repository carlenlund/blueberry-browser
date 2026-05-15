import type React from 'react'

type GuestApi = {
  quickFeedNavigate?: (rawUrl: string) => Promise<unknown>
}

function guestApi(): GuestApi | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as unknown as { blueberryGuest?: GuestApi }).blueberryGuest
}

export async function tryQuickFeedNavigate(rawHref: string): Promise<boolean> {
  const s = typeof rawHref === 'string' ? rawHref.trim() : ''
  if (!s) return false
  const api = guestApi()
  if (api && typeof api.quickFeedNavigate === 'function') {
    try {
      await api.quickFeedNavigate(s)
      return true
    } catch {
      return false
    }
  }
  return false
}

type QuickFeedLinkProps = {
  href: string
  className?: string
  children: React.ReactNode
  /** Called when the user activates the link (before quick-feed or fallback navigation). */
  onWillNavigate?: (rawHref: string) => void
}

/**
 * In-app quick feed when `blueberryGuest.quickFeedNavigate` exists; else normal navigation.
 */
export function QuickFeedLink({
  href,
  className,
  children,
  onWillNavigate,
}: QuickFeedLinkProps) {
  return (
    <a
      href={href}
      className={className}
      onClick={(ev) => {
        ev.preventDefault()
        ev.stopPropagation()
        void (async () => {
          const s = typeof href === 'string' ? href.trim() : ''
          if (s) onWillNavigate?.(s)
          if (await tryQuickFeedNavigate(href)) return
          try {
            window.location.assign(href)
          } catch {
            /* ignore */
          }
        })()
      }}
    >
      {children}
    </a>
  )
}
