import React, { useEffect, useState } from 'react'
import { ChatProvider } from './contexts/ChatContext'
import { Chat } from './components/Chat'
import { useDarkMode } from '@common/hooks/useDarkMode'

const SidebarContent: React.FC = () => {
    const { isDarkMode } = useDarkMode()
    const [traceLabel, setTraceLabel] = useState('Trace')

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
            <div className="shrink-0 px-2 pt-2 pb-1 border-b border-border">
                <button
                    type="button"
                    title={traceLabel}
                    className="h-7 w-full max-w-full truncate rounded px-2 text-left text-xs font-medium border border-border bg-muted text-foreground hover:bg-muted/80"
                    onClick={async () => {
                        const r = await window.sidebarAPI.traceFlow('green', 'sidebar')
                        const text = JSON.stringify(r)
                        setTraceLabel(text)
                        console.log('sidebar trace', r)
                    }}
                >
                    {traceLabel}
                </button>
            </div>
            <Chat />
        </div>
    )
}

export const SidebarApp: React.FC = () => {
    return (
        <ChatProvider>
            <SidebarContent />
        </ChatProvider>
    )
}

