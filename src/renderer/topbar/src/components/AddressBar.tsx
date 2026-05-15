import React, { useEffect, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  RefreshCw,
  Loader2,
  PanelLeftClose,
  PanelLeft,
  Newspaper,
} from 'lucide-react'
import { useBrowser } from '../contexts/BrowserContext'
import { ToolBarButton } from '../components/ToolBarButton'
import { DarkModeToggle } from '../components/DarkModeToggle'
import { normalizeNavigateInput } from '@common/navigateNormalize'

type AddressBarProps = {
  /** When true, only dark mode + sidebar controls (feed overlay is covering the page). */
  feedLayoutOverlayEnabled: boolean
}

export function AddressBar({
  feedLayoutOverlayEnabled,
}: AddressBarProps): React.ReactElement {
  const {
    activeTab,
    navigateToUrl,
    goBack,
    goForward,
    reload,
    isLoading,
  } = useBrowser()
  const [url, setUrl] = useState('')
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const debug = import.meta.env.MODE === 'debug'

  useEffect(() => {
    if (activeTab?.url != null) setUrl(activeTab.url)
  }, [activeTab?.id, activeTab?.url])

  const handleNavigate = (e: React.FormEvent) => {
    e.preventDefault()
    const finalUrl = normalizeNavigateInput(url)
    if (!finalUrl) return
    void navigateToUrl(finalUrl)
    ;(document.activeElement as HTMLElement | null)?.blur()
  }

  const canGoBack = activeTab !== null
  const canGoForward = activeTab !== null

  const toggleSidebar = () => {
    setIsSidebarOpen(!isSidebarOpen)
    void window.topBarAPI.toggleSidebar()
  }

  const inputShell =
    'flex h-8 w-full min-w-0 items-center gap-1.5 rounded-md border border-border bg-background px-2 dark:bg-secondary/40'

  if (feedLayoutOverlayEnabled) {
    return (
      <>
        <div className="app-region-drag min-h-8 min-w-0 flex-1" aria-hidden />
        <div className="flex shrink-0 items-center gap-1 app-region-no-drag">
          {debug ? (
            <ToolBarButton
              Icon={Newspaper}
              onClick={() => {
                void window.topBarAPI.setFeedLayoutOverlayEnabled(false)
              }}
              toggled
              aria-label="Feed overlay on — click to hide"
              title="Feed overlay on"
            />
          ) : null}
          <DarkModeToggle />
          {debug ? (
            <ToolBarButton
              Icon={isSidebarOpen ? PanelLeftClose : PanelLeft}
              onClick={toggleSidebar}
              toggled={isSidebarOpen}
            />
          ) : null}
        </div>
      </>
    )
  }

  return (
    <>
      <div className="flex gap-1.5 app-region-no-drag">
        <ToolBarButton
          Icon={ArrowLeft}
          onClick={goBack}
          active={canGoBack && !isLoading}
        />
        <ToolBarButton
          Icon={ArrowRight}
          onClick={goForward}
          active={canGoForward && !isLoading}
        />
        <ToolBarButton
          onClick={reload}
          active={activeTab !== null && !isLoading}
        >
          {isLoading ? (
            <Loader2 className="size-4.5 animate-spin" />
          ) : (
            <RefreshCw className="size-4.5" />
          )}
        </ToolBarButton>
      </div>

      <form
        onSubmit={handleNavigate}
        className="flex min-w-0 flex-1 gap-2 app-region-no-drag"
      >
        <div className={inputShell}>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="text-foreground placeholder:text-muted-foreground w-full min-w-0 truncate bg-transparent py-0.5 text-xs outline-none"
            placeholder={
              activeTab ? 'URL or search' : 'No active tab'
            }
            disabled={!activeTab}
            spellCheck={false}
          />
        </div>
      </form>

      <div className="flex shrink-0 items-center gap-1 app-region-no-drag">
        <ToolBarButton
          Icon={Newspaper}
          onClick={() => {
            void window.topBarAPI.setFeedLayoutOverlayEnabled(true)
          }}
          toggled={false}
          aria-label="Feed overlay off — click to show"
          title="Feed overlay off"
        />
        <DarkModeToggle />
        {debug ? (
          <ToolBarButton
            Icon={isSidebarOpen ? PanelLeftClose : PanelLeft}
            onClick={toggleSidebar}
            toggled={isSidebarOpen}
          />
        ) : null}
      </div>
    </>
  )
}
