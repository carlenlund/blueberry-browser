import { useState } from 'react'

import { Button } from "@common/components/Button";

const debugBtnClass =
    "h-6 min-h-6 px-1.5 py-0 text-[10px] font-normal leading-none gap-1"

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

    const navigateActiveTab = async (url: string) => {
        const tabInfo = await window.sidebarAPI.getActiveTabInfo()
        if (!tabInfo) {
            return
        }
        const script =
            '(() => { location.href = ' + JSON.stringify(url) + '; })()'
        await window.sidebarAPI.tabRunJs(tabInfo.id, script)
    }

    return (
        <div className="flex flex-col gap-1.5 p-2">
            <div className="flex flex-wrap gap-1">
            <Button
                variant="outline"
                size="xs"
                className={debugBtnClass}
                onClick={() =>
                    void navigateActiveTab('https://old.reddit.com/r/programming/')
                }
            >
                r/programming
            </Button>
            <Button
                variant="outline"
                size="xs"
                className={debugBtnClass}
                onClick={() =>
                    void navigateActiveTab('https://hackernews.com/')
                }
            >
                Hacker News
            </Button>
            <Button
                variant="outline"
                size="xs"
                className={debugBtnClass}
                onClick={() =>
                    void navigateActiveTab('https://www.breakit.se/')
                }
            >
                Breakit
            </Button>
            <Button
                variant="outline"
                size="xs"
                className={debugBtnClass}
                onClick={() =>
                    void navigateActiveTab('https://www.svd.se/')
                }
            >
                SvD
            </Button>
            <Button
                variant="outline"
                size="xs"
                className={debugBtnClass}
                onClick={() =>
                    void navigateActiveTab(
                        'https://www.linkedin.com/company/strawberry-browser',
                    )
                }
            >
                Strawberry (LinkedIn)
            </Button>
            <Button variant="outline" size="xs" className={debugBtnClass} onClick={async () => {
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
            <Button variant="outline" size="xs" className={debugBtnClass} onClick={async () => {
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
            <Button variant="outline" size="xs" className={debugBtnClass} onClick={async () => {
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
            <Button variant="outline" size="xs" className={debugBtnClass} onClick={async () => {
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
            <Button
                type="button"
                variant="outline"
                size="xs"
                className={debugBtnClass}
                onClick={runCustomJs}
            >
                Run custom JS (Ctrl+Enter)
            </Button>
        </div>
    )
}