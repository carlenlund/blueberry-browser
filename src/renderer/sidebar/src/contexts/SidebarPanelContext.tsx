import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'

import { MAIN_FEED_OVERLAY_LOADING_PAYLOAD } from '@common/feedOverlayConstants'

export type SidebarPanel = 'chat' | 'map'

export type MapPanelDisplayPreference = 'json' | 'feed' | 'visual'

export type PendingMapImportSpec = {
  markdown: string
  thenDisplay?: MapPanelDisplayPreference | null
} | null

type SidebarPanelContextValue = {
  panel: SidebarPanel
  setPanel: (p: SidebarPanel) => void
  /** Set chat textarea content and switch to Chat; user sends manually. */
  prefillChatComposer: (fullMessage: string) => void
  /** Staged message for Chat to consume into its input once. */
  stagedChatComposer: string | null
  clearStagedChatComposer: () => void
  /** Latest page-map JSON from Map panel when staging Chat (JSON or JS path). Used to run assistant JS locally. */
  domMapJsonSnapshot: string | null
  rememberDomMapJsonSnapshot: (json: string) => void
  /** Map panel consumes this payload (paste + parse); optional preferred view after a successful parse. */
  pendingMapImport: PendingMapImportSpec
  requestMapJsonImport: (
    jsonOrMarkdown: string,
    opts?: { thenDisplay?: MapPanelDisplayPreference },
  ) => void
  clearPendingMapImport: () => void
  /** Bumps whenever the browser guest page cross-navigates; Map panel resets. */
  mapGuestDocumentNavigationEpoch: number
  /**
   * Payload for the main tab feed overlay: loading sentinel or flattened JSON.
   * Top-bar toggle controls whether it is shown.
   */
  mainWebFeedOverlay: string
  setMainWebFeedOverlay: (payload: string) => void
}

const SidebarPanelContext = createContext<SidebarPanelContextValue | null>(
  null,
)

export const useSidebarPanel = () => {
  const ctx = useContext(SidebarPanelContext)
  if (!ctx) {
    throw new Error('useSidebarPanel must be used within SidebarPanelProvider')
  }
  return ctx
}

export const SidebarPanelProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [panel, setPanel] = useState<SidebarPanel>('map')
  const [stagedChatComposer, setStagedChatComposer] = useState<string | null>(
    null,
  )
  const [pendingMapImport, setPendingMapImport] =
    useState<PendingMapImportSpec>(null)
  const [domMapJsonSnapshot, setDomMapJsonSnapshot] = useState<string | null>(
    null,
  )
  const [mainWebFeedOverlay, setMainWebFeedOverlay] = useState<string>(
    MAIN_FEED_OVERLAY_LOADING_PAYLOAD,
  )
  const [mapGuestDocumentNavigationEpoch, setMapGuestDocumentNavigationEpoch] =
    useState(0)

  const clearStaleMapAfterGuestNavigation = useCallback(() => {
    setDomMapJsonSnapshot(null)
    // Do not clear `pendingMapImport` here: quick-feed often finishes after one or more
    // `did-start-navigation` redirects (e.g. Google); clearing pending would drop the
    // pipeline result before PageMapPanel's import effect runs.
    // Do not set mainWebFeedOverlay to loading here: main already pushes loading to the
    // overlay on guest cross-document navigation; doing both duplicates chat segments.
    setMapGuestDocumentNavigationEpoch((n) => n + 1)
  }, [])

  useEffect(() => {
    window.sidebarAPI.onGuestTabDocumentNavigated(
      clearStaleMapAfterGuestNavigation,
    )
    return () => {
      window.sidebarAPI.removeGuestTabDocumentNavigatedListener()
    }
  }, [clearStaleMapAfterGuestNavigation])

  const prefillChatComposer = useCallback((fullMessage: string) => {
    setStagedChatComposer(fullMessage)
    setPanel('chat')
  }, [])

  const clearStagedChatComposer = useCallback(() => {
    setStagedChatComposer(null)
  }, [])

  const requestMapJsonImport = useCallback(
    (
      jsonOrMarkdown: string,
      opts?: { thenDisplay?: MapPanelDisplayPreference },
    ) => {
      setPendingMapImport({
        markdown: jsonOrMarkdown,
        ...(opts?.thenDisplay != null
          ? { thenDisplay: opts.thenDisplay }
          : {}),
      })
      setPanel('map')
    },
    [],
  )

  const clearPendingMapImport = useCallback(() => {
    setPendingMapImport(null)
  }, [])

  const rememberDomMapJsonSnapshot = useCallback((json: string) => {
    setDomMapJsonSnapshot(json)
  }, [])

  const value = useMemo(
    () =>
      ({
        panel,
        setPanel,
        prefillChatComposer,
        stagedChatComposer,
        clearStagedChatComposer,
        pendingMapImport,
        requestMapJsonImport,
        clearPendingMapImport,
        domMapJsonSnapshot,
        rememberDomMapJsonSnapshot,
        mainWebFeedOverlay,
        setMainWebFeedOverlay,
        mapGuestDocumentNavigationEpoch,
      }) satisfies SidebarPanelContextValue,
    [
      panel,
      prefillChatComposer,
      stagedChatComposer,
      clearStagedChatComposer,
      pendingMapImport,
      requestMapJsonImport,
      clearPendingMapImport,
      domMapJsonSnapshot,
      rememberDomMapJsonSnapshot,
      mainWebFeedOverlay,
      setMainWebFeedOverlay,
      mapGuestDocumentNavigationEpoch,
    ],
  )

  return (
    <SidebarPanelContext.Provider value={value}>
      {children}
    </SidebarPanelContext.Provider>
  )
}
