import React from 'react'
import { cn } from '@common/lib/utils'

/** Step-by-step form/DOM introspection (read-only); avoids “automate this site” phrasing. */
const DEMO_PROMPTS: { label: string; prompt: string }[] = [
    {
        label: 'Fields · list inputs',
        prompt:
            'Give me one javascript snippet (single fenced block) for executeJavaScript in this page that **returns** a JSON array of every input, textarea, and select. For each element include: tagName, type, name, id, placeholder, the boolean required, and labelText from an associated label element if you can resolve it (else empty string). Truncate labelText to 80 characters. Read-only — do not change the DOM.'
    },
    {
        label: 'Fields · list forms',
        prompt:
            'Give me one javascript snippet that **returns** a JSON array describing each form: index, action, method, enctype, and fieldNames (name attributes of nested controls, empty string if none). Read-only — do not submit or modify anything.'
    },
    {
        label: 'Fields · suggest test values',
        prompt:
            'Give me one javascript snippet that **returns** JSON { suggestions: [...] } with one object per visible text-like control (input type text, email, tel, url, search, number, textarea): { selector, suggestedValue } using obvious fake test data (e.g. Jane Doe, test@example.com). **Do not** assign to fields or click anything — suggestions only. Read-only.'
    },
    {
        label: 'Navigate + extract',
        prompt:
            'From this page, open the link that goes to **[Article / Docs section / topic name]** (describe it the way you see it in the menu). After it loads, reply with only: (a) the exact main heading text, and (b) the first full sentence of the body under it.'
    },
    {
        label: 'Search funnel',
        prompt:
            'In the search box, search for **rust ownership borrowing**. When results appear, open the **first organic result** that looks like documentation or an article—not an ad or sponsored block—and stop once that page has loaded. Tell me the final URL and page title.'
    }
]

export const PromptChips: React.FC<{
    onSelect: (prompt: string) => void
    disabled: boolean
}> = ({ onSelect, disabled }) => (
    <div className="shrink-0 border-b border-border px-3 py-2 space-y-1.5 bg-muted/30 dark:bg-muted/10">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium px-0.5">
            Try a prompt
        </p>
        <div className="flex flex-col gap-1 max-h-[min(40vh,220px)] overflow-y-auto pr-0.5">
            {DEMO_PROMPTS.map(({ label, prompt }) => (
                <button
                    key={label}
                    type="button"
                    disabled={disabled}
                    onClick={() => onSelect(prompt)}
                    className={cn(
                        'text-left text-xs rounded-lg px-2.5 py-1.5 transition-colors',
                        'bg-background/80 dark:bg-background/40 border border-border/80',
                        'hover:bg-accent hover:text-accent-foreground',
                        'disabled:opacity-50 disabled:pointer-events-none'
                    )}
                >
                    {label}
                </button>
            ))}
        </div>
    </div>
)
