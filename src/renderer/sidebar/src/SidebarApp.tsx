import React, { useEffect, useState } from 'react'
import { ChatProvider } from './contexts/ChatContext'
import { Chat } from './components/Chat'
import { useDarkMode } from '@common/hooks/useDarkMode'
import { DebugButtons } from './components/DebugButtons'
import { AgentControls } from './components/AgentControls'
import { Button } from '@common/components/Button'

type SidebarPanel = 'chat' | 'agent'

const SidebarContent: React.FC = () => {
    const [panel, setPanel] = useState<SidebarPanel>('chat')
    const { isDarkMode } = useDarkMode()

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
                    variant={panel === 'agent' ? 'secondary' : 'ghost'}
                    onClick={() => setPanel('agent')}
                    disabled={import.meta.env.MODE !== 'debug'}
                >
                    Agent
                </Button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                {panel === 'chat' ? <Chat /> : <AgentControls />}
            </div>
            {/* Debug Actions (only when running `npm run debug`) */}
            {import.meta.env.MODE === 'debug' && (
                <div className="flex-1">
                    <DebugButtons />
                </div>
            )}
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

