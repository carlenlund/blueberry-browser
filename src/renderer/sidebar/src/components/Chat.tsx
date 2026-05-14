import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import { ArrowUp, Plus, Copy, Play } from 'lucide-react'
import { useChat } from '../contexts/ChatContext'
import { cn } from '@common/lib/utils'
import { Button } from '@common/components/Button'
import { extractFirstFencedJavaScript } from '../lib/extractFencedJs'
import { invokeRunConfirmedScript } from '../lib/invokeRunConfirmedScript'
import { PromptChips } from './PromptChips'
import type { ChatSidebarMessage } from '../types/chat'

// Auto-scroll hook
const useAutoScroll = (
    messages: ChatSidebarMessage[]
): React.RefObject<HTMLDivElement | null> => {
    const scrollRef = useRef<HTMLDivElement>(null)
    const prevCount = useRef(0)

    useLayoutEffect(() => {
        if (messages.length > prevCount.current) {
            setTimeout(() => {
                scrollRef.current?.scrollIntoView({
                    behavior: 'smooth',
                    block: 'end'
                })
            }, 100)
        }
        prevCount.current = messages.length
    }, [messages.length])

    return scrollRef
}

// User Message Component - appears on the right
const UserMessage: React.FC<{ content: string }> = ({ content }) => (
    <div className="relative max-w-[85%] ml-auto animate-fade-in">
        <div className="bg-muted dark:bg-muted/50 rounded-3xl px-6 py-4">
            <div className="text-foreground" style={{ whiteSpace: 'pre-wrap' }}>
                {content}
            </div>
        </div>
    </div>
)

// Streaming Text Component
const StreamingText: React.FC<{ content: string }> = ({ content }) => {
    const [displayedContent, setDisplayedContent] = useState('')
    const [currentIndex, setCurrentIndex] = useState(0)

    useEffect(() => {
        if (currentIndex < content.length) {
            const timer = setTimeout(() => {
                setDisplayedContent(content.slice(0, currentIndex + 1))
                setCurrentIndex(currentIndex + 1)
            }, 10)
            return () => clearTimeout(timer)
        }
        return undefined
    }, [content, currentIndex])

    return (
        <div className="whitespace-pre-wrap text-foreground">
            {displayedContent}
            {currentIndex < content.length && (
                <span className="inline-block w-2 h-5 bg-primary/60 dark:bg-primary/40 ml-0.5 animate-pulse" />
            )}
        </div>
    )
}

// Markdown Renderer Component
const Markdown: React.FC<{ content: string }> = ({ content }) => (
    <div className="prose prose-sm dark:prose-invert max-w-none 
                    prose-headings:text-foreground prose-p:text-foreground 
                    prose-strong:text-foreground prose-ul:text-foreground 
                    prose-ol:text-foreground prose-li:text-foreground
                    prose-a:text-primary hover:prose-a:underline
                    prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 
                    prose-code:rounded prose-code:text-sm prose-code:text-foreground
                    prose-pre:bg-muted dark:prose-pre:bg-muted/50 prose-pre:p-3 
                    prose-pre:rounded-lg prose-pre:overflow-x-auto">
        <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkBreaks]}
            components={{
                // Custom code block styling
                code: ({ className, children, ...props }) => {
                    const inline = !className
                    return inline ? (
                        <code className="bg-muted dark:bg-muted/50 px-1 py-0.5 rounded text-sm text-foreground" {...props}>
                            {children}
                        </code>
                    ) : (
                        <code className={className} {...props}>
                            {children}
                        </code>
                    )
                },
                // Custom link styling
                a: ({ children, href }) => (
                    <a
                        href={href}
                        className="text-primary hover:underline"
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        {children}
                    </a>
                ),
            }}
        >
            {content}
        </ReactMarkdown>
    </div>
)

// Assistant Message Component - appears on the left
const AssistantMessage: React.FC<{ content: string; isStreaming?: boolean }> = ({
    content,
    isStreaming
}) => (
    <div className="relative w-full animate-fade-in">
        <div className="py-1">
            {isStreaming ? (
                <StreamingText content={content} />
            ) : (
                <Markdown content={content} />
            )}
        </div>
    </div>
)

// Loading Indicator with spinning star
const LoadingIndicator: React.FC = () => {
    const [isVisible, setIsVisible] = useState(false)

    useEffect(() => {
        setIsVisible(true)
    }, [])

    return (
        <div className={cn(
            "transition-transform duration-300 ease-in-out",
            isVisible ? "scale-100" : "scale-0"
        )}>
            ...
        </div>
    )
}

// Chat Input Component with pill design
const ChatInput: React.FC<{
    onSend: (message: string) => void
    disabled: boolean
}> = ({ onSend, disabled }) => {
    const [value, setValue] = useState('')
    const [isFocused, setIsFocused] = useState(false)
    const textareaRef = useRef<HTMLTextAreaElement>(null)

    // Auto-resize textarea
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto'
            const scrollHeight = textareaRef.current.scrollHeight
            const newHeight = Math.min(scrollHeight, 200) // Max 200px
            textareaRef.current.style.height = `${newHeight}px`
        }
    }, [value])

    const handleSubmit = (): void => {
        if (value.trim() && !disabled) {
            onSend(value.trim())
            setValue('')
            // Reset textarea height
            if (textareaRef.current) {
                textareaRef.current.style.height = '24px'
            }
        }
    }

    const handleKeyDown = (e: React.KeyboardEvent): void => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            handleSubmit()
        }
    }

    return (
        <div className={cn(
            "w-full border p-3 rounded-3xl bg-background dark:bg-secondary",
            "shadow-chat animate-spring-scale outline-none transition-all duration-200",
            isFocused ? "border-primary/20 dark:border-primary/30" : "border-border"
        )}>
            {/* Input Area */}
            <div className="w-full px-3 py-2">
                <div className="w-full flex items-start gap-3">
                    <div className="relative flex-1 overflow-hidden">
                        <textarea
                            ref={textareaRef}
                            value={value}
                            onChange={(e) => setValue(e.target.value)}
                            onFocus={() => setIsFocused(true)}
                            onBlur={() => setIsFocused(false)}
                            onKeyDown={handleKeyDown}
                            placeholder="Send a message..."
                            className="w-full resize-none outline-none bg-transparent 
                                     text-foreground placeholder:text-muted-foreground
                                     min-h-[24px] max-h-[200px]"
                            rows={1}
                            style={{ lineHeight: '24px' }}
                        />
                    </div>
                </div>
            </div>

            {/* Send Button */}
            <div className="w-full flex items-center gap-1.5 px-1 mt-2 mb-1">
                <div className="flex-1" />
                <button
                    onClick={handleSubmit}
                    disabled={disabled || !value.trim()}
                    className={cn(
                        "size-9 rounded-full flex items-center justify-center",
                        "transition-all duration-200",
                        "bg-primary text-primary-foreground",
                        "hover:opacity-80 disabled:opacity-50"
                    )}
                >
                    <ArrowUp className="size-5" />
                </button>
            </div>
        </div>
    )
}

// Conversation Turn Component
interface ConversationTurn {
    user?: ChatSidebarMessage
    assistant?: ChatSidebarMessage
}

const ConversationTurnComponent: React.FC<{
    turn: ConversationTurn
    isLoading?: boolean
}> = ({ turn, isLoading }) => (
    <div className="pt-12 flex flex-col gap-8">
        {turn.user && <UserMessage content={turn.user.content} />}
        {turn.assistant && (
            <AssistantMessage
                content={turn.assistant.content}
                isStreaming={turn.assistant.isStreaming}
            />
        )}
        {isLoading && (
            <div className="flex justify-start">
                <LoadingIndicator />
            </div>
        )}
    </div>
)

// Main Chat Component
export const Chat: React.FC = () => {
    const { messages, isLoading, sendMessage, clearChat } = useChat()
    const scrollRef = useAutoScroll(messages)

    const [pendingScript, setPendingScript] = useState<{
        code: string
        messageIndex: number
    } | null>(null)
    const [executionResult, setExecutionResult] = useState<string | null>(null)
    const [runningScript, setRunningScript] = useState(false)
    const lastParsedAssistantIndex = useRef<number | null>(null)

    useEffect(() => {
        if (isLoading) {
            setPendingScript(null)
            setExecutionResult(null)
            lastParsedAssistantIndex.current = null
            return
        }
        const lastIdx = messages.length - 1
        const last = messages[lastIdx]
        if (!last || last.role !== 'assistant') {
            return
        }
        if (lastParsedAssistantIndex.current === lastIdx) {
            return
        }
        lastParsedAssistantIndex.current = lastIdx
        const code = extractFirstFencedJavaScript(last.content)
        if (code) {
            setPendingScript({ code, messageIndex: lastIdx })
        } else {
            setPendingScript(null)
        }
    }, [messages, isLoading])

    const handleConfirmRun = useCallback(async (): Promise<void> => {
        if (!pendingScript?.code) return
        setRunningScript(true)
        try {
            const res = await invokeRunConfirmedScript(pendingScript.code)
            setExecutionResult(res.display)
            setPendingScript(null)
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            setExecutionResult(`Error:\n${msg}`);
            setPendingScript(null);
        } finally {
            setRunningScript(false)
        }
    }, [pendingScript])

    const copyResult = useCallback((): void => {
        if (executionResult == null) return
        void navigator.clipboard.writeText(executionResult)
    }, [executionResult])

    // Group messages into conversation turns
    const conversationTurns: ConversationTurn[] = []
    for (let i = 0; i < messages.length; i++) {
        if (messages[i].role === 'user') {
            const turn: ConversationTurn = { user: messages[i] }
            if (messages[i + 1]?.role === 'assistant') {
                turn.assistant = messages[i + 1]
                i++
            }
            conversationTurns.push(turn)
        } else if (
            messages[i].role === 'assistant' &&
            (i === 0 || messages[i - 1]?.role !== 'user')
        ) {
            conversationTurns.push({ assistant: messages[i] })
        }
    }

    const showLoadingAfterLastTurn =
        isLoading && messages[messages.length - 1]?.role === 'user'

    return (
        <div className="flex flex-col h-full bg-background min-h-0">
            <PromptChips onSelect={sendMessage} disabled={isLoading} />

            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                <div className="flex-1 overflow-y-auto">
                    <div className="h-8 max-w-3xl mx-auto px-4">
                        {messages.length > 0 && (
                            <Button
                                onClick={clearChat}
                                title="Start new chat"
                                variant="ghost"
                            >
                                <Plus className="size-4" />
                                New Chat
                            </Button>
                        )}
                    </div>

                    <div className="pb-4 relative max-w-3xl mx-auto px-4">
                        {messages.length === 0 ? (
                            <div className="flex items-center justify-center h-full min-h-[280px]">
                                <div className="text-center animate-fade-in max-w-md mx-auto gap-2 flex flex-col">
                                    <h3 className="text-2xl font-bold">🫐</h3>
                                    <p className="text-muted-foreground text-sm">
                                        Pick a prompt above or type below. The model replies
                                        with JavaScript—confirm before it runs in the active tab.
                                    </p>
                                    <p className="text-muted-foreground text-xs">
                                        Press ⌘E to toggle the sidebar
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <>
                                {conversationTurns.map((turn, index) => (
                                    <ConversationTurnComponent
                                        key={`turn-${index}`}
                                        turn={turn}
                                        isLoading={
                                            showLoadingAfterLastTurn &&
                                            index === conversationTurns.length - 1
                                        }
                                    />
                                ))}
                            </>
                        )}

                        <div ref={scrollRef} />
                    </div>
                </div>

                {pendingScript && (
                    <div className="shrink-0 border-t border-border bg-muted/20 dark:bg-muted/10 px-4 py-3 max-w-3xl mx-auto w-full space-y-2">
                        <p className="text-xs font-medium text-foreground">
                            Pending script — review before running in the active tab
                        </p>
                        <pre className="text-[11px] leading-snug max-h-32 overflow-auto rounded-md border border-border bg-background p-2 whitespace-pre-wrap break-all">
                            {pendingScript.code}
                        </pre>
                        <Button
                            type="button"
                            size="sm"
                            disabled={runningScript}
                            onClick={() => void handleConfirmRun()}
                            className="gap-1.5"
                        >
                            <Play className="size-3.5" />
                            {runningScript ? 'Running…' : 'Confirm & run'}
                        </Button>
                    </div>
                )}

                {executionResult !== null && (
                    <div className="shrink-0 border-t border-border px-4 py-3 max-w-3xl mx-auto w-full space-y-2">
                        <div className="flex items-center justify-between gap-2">
                            <p className="text-xs font-medium text-foreground">
                                Page script result
                            </p>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-7 gap-1 text-xs"
                                onClick={copyResult}
                            >
                                <Copy className="size-3" />
                                Copy
                            </Button>
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                            Paste this back into the chat to continue the conversation.
                        </p>
                        <pre className="text-[11px] leading-snug max-h-40 overflow-auto rounded-md border border-border bg-muted/30 dark:bg-muted/20 p-2 whitespace-pre-wrap break-words font-mono">
                            {executionResult}
                        </pre>
                    </div>
                )}

                <div className="p-4 shrink-0">
                    <ChatInput onSend={sendMessage} disabled={isLoading} />
                </div>
            </div>
        </div>
    )
}