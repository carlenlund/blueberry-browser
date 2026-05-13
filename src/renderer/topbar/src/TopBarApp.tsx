import React, { useState } from 'react'
import { BrowserProvider } from './contexts/BrowserContext'
import { TabBar } from './components/TabBar'
import { AddressBar } from './components/AddressBar'

export const TopBarApp: React.FC = () => {
    const [traceLabel, setTraceLabel] = useState('Trace')

    return (
        <BrowserProvider>
            <div className="flex flex-col bg-background select-none">
                {/* Tab Bar */}
                <div className="w-full h-10 pr-2 flex items-center app-region-drag bg-muted dark:bg-muted">
                    <TabBar />
                </div>

                {/* Toolbar */}
                <div className="flex items-center px-2 py-1 gap-2 app-region-drag bg-background shadow-subtle z-10 dark:shadow-[0_0_6px_rgba(0,0,0,0.2)]">
                    <button
                        type="button"
                        title={traceLabel}
                        className="h-7 max-w-[240px] truncate rounded px-2 text-left text-xs font-medium border border-border bg-muted text-foreground hover:bg-muted/80 app-region-no-drag"
                        onClick={async () => {
                            const r = await window.topBarAPI.traceFlow('green', 'topbar')
                            setTraceLabel(JSON.stringify(r))
                            console.log('topbar trace', r)
                        }}
                    >
                        {traceLabel}
                    </button>
                    <div className="flex-1 min-w-0 app-region-no-drag">
                        <AddressBar />
                    </div>
                </div>
            </div>
        </BrowserProvider>
    )
}

