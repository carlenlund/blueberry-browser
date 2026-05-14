import { useState } from 'react'

import { Button } from "@common/components/Button";

export const DebugButtons = () => {
    const [customJs, setCustomJs] = useState('')

    const runCustomJs = async () => {
        const trimmed = customJs.trim()
        if (!trimmed) {
            return
        }
        const script = '(() => {\n' + trimmed + '\n})()'

        const tabInfo = await window.sidebarAPI.getActiveTabInfo()
        if (tabInfo) {
            window.sidebarAPI.tabRunJs(tabInfo.id, script)
        }
    }

    return (
        <div className="flex flex-col gap-2 p-4">
            <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={async () => {
                const script = `(() => {
                alert("Hello, world!")
                })()`;

                const tabInfo = await window.sidebarAPI.getActiveTabInfo();
                if (tabInfo) {
                    window.sidebarAPI.tabRunJs(tabInfo.id, script);
                }
            }}>
                alert
            </Button>
            <Button variant="outline" onClick={async () => {
                const script = `(() => {
                console.log("Hello, world!")
                })()`;

                const tabInfo = await window.sidebarAPI.getActiveTabInfo();
                if (tabInfo) {
                    window.sidebarAPI.tabRunJs(tabInfo.id, script);
                }
            }}>
                console.log
            </Button>
            <Button variant="outline" onClick={async () => {
                const script = `(() => {
                const inputs = document.querySelectorAll('input');
                console.log(inputs);
                })()`;

                const tabInfo = await window.sidebarAPI.getActiveTabInfo();
                if (tabInfo) {
                    window.sidebarAPI.tabRunJs(tabInfo.id, script);
                }
            }}>
                query inputs
            </Button>
            <Button variant="outline" onClick={async () => {
                const script = `(() => {
                const inputs = document.querySelectorAll('input');
                console.log(inputs);
                })()`;

                const tabInfo = await window.sidebarAPI.getActiveTabInfo();
                if (tabInfo) {
                    window.sidebarAPI.tabRunJs(tabInfo.id, script);
                }
            }}>
                query inputs
            </Button>
            </div>
            <textarea
                className="font-mono text-xs w-full min-h-[120px] rounded border border-border bg-background px-2 py-1.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder="JavaScript to run in the active tab"
                spellCheck={false}
                value={customJs}
                onChange={(e) => setCustomJs(e.target.value)}
                onKeyDown={(e) => {
                    if (e.ctrlKey && e.key === 'Enter') {
                        e.preventDefault()
                        void runCustomJs()
                    }
                }}
            />
            <Button type="button" variant="outline" onClick={runCustomJs}>
                Run custom JS (Ctrl+Enter)
            </Button>
        </div>
    )
}