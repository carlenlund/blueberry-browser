import React, { useEffect, useState } from 'react'
import { BrowserProvider } from './contexts/BrowserContext'
import { TabBar } from './components/TabBar'
import { AddressBar } from './components/AddressBar'

export const TopBarApp: React.FC = () => {
  const [feedLayoutOverlayEnabled, setFeedLayoutOverlayEnabled] =
    useState(true)

  useEffect(() => {
    void window.topBarAPI
      .getFeedLayoutOverlayEnabled()
      .then(setFeedLayoutOverlayEnabled)
    window.topBarAPI.onFeedLayoutOverlayEnabledChanged(
      setFeedLayoutOverlayEnabled,
    )
    return () => {
      window.topBarAPI.removeFeedLayoutOverlayEnabledListener()
    }
  }, [])

  return (
    <BrowserProvider>
      <div className="flex flex-col bg-background select-none">
        {!feedLayoutOverlayEnabled ? (
          <div className="app-region-drag topbar-wco-trailing flex h-10 w-full items-center bg-muted dark:bg-muted">
            <TabBar />
          </div>
        ) : (
          <div
            className="app-region-drag topbar-wco-trailing h-10 w-full shrink-0 bg-background"
            aria-hidden
          />
        )}

        <div
          className={`app-region-drag topbar-wco-trailing z-10 flex items-center gap-2 bg-background py-1 pl-2 ${
            feedLayoutOverlayEnabled
              ? ''
              : 'shadow-subtle dark:shadow-[0_0_6px_rgba(0,0,0,0.2)]'
          }`}
        >
          <AddressBar feedLayoutOverlayEnabled={feedLayoutOverlayEnabled} />
        </div>
      </div>
    </BrowserProvider>
  )
}
