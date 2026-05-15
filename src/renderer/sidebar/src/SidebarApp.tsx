import React, { useEffect, useState, useRef } from 'react'
import { ChevronDown } from 'lucide-react'
import { ChatProvider, useChat } from './contexts/ChatContext'
import { SidebarPanelProvider, useSidebarPanel } from './contexts/SidebarPanelContext'
import { Chat } from './components/Chat'
import { runQuickFeedPipeline, isQuickFeedAborted } from './lib/quickFeedPipeline'
import { useDarkMode } from '@common/hooks/useDarkMode'
import { DebugButtons } from './components/DebugButtons'
import { PageMapPanel } from './components/PageMapPanel'
import { Button } from '@common/components/Button'
import { cn } from '@common/lib/utils'

const MainWebFeedOverlaySync: React.FC = () => {
    const { mainWebFeedOverlay } = useSidebarPanel()
    const [feedEnabled, setFeedEnabled] = useState(true)

    useEffect(() => {
        void window.sidebarAPI.getFeedLayoutOverlayEnabled().then(setFeedEnabled)
        window.sidebarAPI.onFeedLayoutOverlayEnabledChanged((v) =>
            setFeedEnabled(v),
        )
        return () => {
            window.sidebarAPI.removeFeedLayoutOverlayEnabledListener()
        }
    }, [])

    useEffect(() => {
        const api = window.sidebarAPI
        if (typeof api.setMainAreaFeedMode !== 'function') return
        if (!feedEnabled) {
            void api.setMainAreaFeedMode(false)
            return
        }
        void api.setMainAreaFeedMode(true, mainWebFeedOverlay)
    }, [feedEnabled, mainWebFeedOverlay])

    useEffect(() => {
        const api = window.sidebarAPI
        if (typeof api.onDismissMainFeedOverlay !== 'function') return undefined
        const handler = () => {
            void api.setFeedLayoutOverlayEnabled(false)
        }
        api.onDismissMainFeedOverlay(handler)
        return () => {
            api.removeDismissMainFeedOverlayListener()
        }
    }, [])

    return null
}

const QuickFeedAutomationHost: React.FC = () => {
    const { sendMessage, clearChat } = useChat()
    const {
        rememberDomMapJsonSnapshot,
        requestMapJsonImport,
        setPanel,
    } = useSidebarPanel()

    const runGenRef = useRef(0)

    useEffect(() => {
        const handler = () => {
            runGenRef.current++
            const gen = runGenRef.current
            void runQuickFeedPipeline({
                includeHiddenStructure: false,
                sendMessage,
                clearChat,
                rememberDomMapJsonSnapshot,
                requestMapJsonImport,
                setPanel,
                shouldAbort: () => runGenRef.current !== gen,
            }).catch((e) => {
                if (isQuickFeedAborted(e)) return
                console.error('[quick-feed]', e)
            })
        }
        window.sidebarAPI.onQuickFeedAutomationRun(handler)
        return () => window.sidebarAPI.removeQuickFeedAutomationRunListener()
    }, [
        sendMessage,
        clearChat,
        rememberDomMapJsonSnapshot,
        requestMapJsonImport,
        setPanel,
    ])

    return null
}

const SidebarContent: React.FC = () => {
    const { panel, setPanel } = useSidebarPanel()
    const { isDarkMode } = useDarkMode()
    const [debugCollapsed, setDebugCollapsed] = useState(false)

    // Apply dark mode class to the document
    useEffect(() => {
        if (isDarkMode) {
            document.documentElement.classList.add('dark')
        } else {
            document.documentElement.classList.remove('dark')
        }
    }, [isDarkMode])

    return (
        <div className="h-screen flex flex-col bg-background border-l border-border">
            <div className="flex shrink-0 gap-1 border-b border-border p-4 py-2">
                <Button
                    type="button"
                    variant={panel === 'chat' ? 'secondary' : 'ghost'}
                    onClick={() => setPanel('chat')}
                >
                    Chat
                </Button>
                <Button
                    type="button"
                    variant={panel === 'map' ? 'secondary' : 'ghost'}
                    onClick={() => setPanel('map')}
                >
                    Map
                </Button>
            </div>
            <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
                {/* Keep all panels mounted so parsed map JSON and chat state survive tab clicks. */}
                <div
                    className={cn(
                        'flex min-h-0 flex-1 flex-col overflow-hidden',
                        panel !== 'chat' && 'hidden',
                    )}
                    aria-hidden={panel !== 'chat'}
                >
                    <Chat />
                </div>
                <div
                    className={cn(
                        'flex min-h-0 flex-1 flex-col overflow-hidden',
                        panel !== 'map' && 'hidden',
                    )}
                    aria-hidden={panel !== 'map'}
                >
                    <PageMapPanel />
                </div>
            </div>
            {/* Debug Actions (only when running `npm run debug`) */}
            {import.meta.env.MODE === 'debug' && (
                <div className="shrink-0 border-t border-border">
                    <button
                        type="button"
                        className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-muted-foreground hover:bg-muted/50"
                        onClick={() => setDebugCollapsed((c) => !c)}
                        aria-expanded={!debugCollapsed}
                    >
                        <ChevronDown
                            className={`h-4 w-4 shrink-0 text-foreground transition-transform ${debugCollapsed ? '-rotate-90' : ''}`}
                            aria-hidden
                        />
                        Debug
                    </button>
                    {!debugCollapsed && <DebugButtons />}
                </div>
            )}
        </div>
    )
}

export const SidebarApp: React.FC = () => {
    return (
        <ChatProvider>
            <SidebarPanelProvider>
                <MainWebFeedOverlaySync />
                <QuickFeedAutomationHost />
                <SidebarContent />
            </SidebarPanelProvider>
        </ChatProvider>
    )
}
