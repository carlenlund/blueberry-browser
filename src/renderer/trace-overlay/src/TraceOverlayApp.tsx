import React, { useState } from 'react'

export const TraceOverlayApp: React.FC = () => {
    const [traceLabel, setTraceLabel] = useState('Trace')

    return (
        <div className="h-full w-full flex items-stretch bg-transparent select-none">
            <button
                type="button"
                title={traceLabel}
                className="h-full w-full truncate rounded-md px-2 text-left text-xs font-medium border border-border bg-muted text-foreground hover:bg-muted/80"
                onClick={async () => {
                    const r = await window.traceOverlayAPI.traceFlow('green', 'overlay')
                    setTraceLabel(JSON.stringify(r))
                    console.log('trace overlay', r)
                }}
            >
                {traceLabel}
            </button>
        </div>
    )
}
