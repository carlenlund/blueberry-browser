import React, { useState, useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import { ArrowUp, Plus } from 'lucide-react'
import { useChat } from '../contexts/ChatContext'
import { cn } from '@common/lib/utils'
import { Button } from '@common/components/Button'
import { BlueberryLogoMark } from './BlueberryLogoMark'
import { useChatAutoScroll } from '../hooks/useChatAutoScroll'

interface Message {
    id: string
    role: 'user' | 'assistant'
    content: string
    timestamp: number
    isStreaming?: boolean
}

// User Message Component - appears on the right
const UserMessage: React.FC<{ content: string }> = ({ content }) => (
    <div className="relative max-w-[80%] ml-auto animate-fade-in">
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
        if (currentIndex >= content.length) return
        const timer = setTimeout(() => {
            setDisplayedContent(content.slice(0, currentIndex + 1))
            setCurrentIndex(currentIndex + 1)
        }, 10)
        return () => clearTimeout(timer)
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
const Markdown: React.FC<{ content: string, linkCallback: (content: string) => void }> = ({ content, linkCallback }) => (
    <div className="prose prose-sm dark:prose-invert max-w-none 
                    prose-headings:text-foreground prose-p:text-foreground prose-p:mt-0 prose-p:mb-4 [&_p:last-child]:mb-0
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
                // Preflight removes default <p> margins; typography plugin is not installed,
                // so prose-* classes do not apply — spacing must be explicit.
                p: ({ children, ...props }) => (
                    <p className={cn('text-foreground leading-relaxed [&:not(:last-child)]:mb-4')} {...props}>
                        {children}
                    </p>
                ),
                // remark-breaks turns single newlines into <br>; treat as a paragraph-ish gap.
                br: (props) => <br className="block mb-4" {...props} />,
                // Preflight strips list markers/padding — restore normal list layout.
                ul: ({ children, className, ...props }) => (
                    <ul
                        className={cn(
                            'my-3 list-outside list-disc space-y-1 pl-5 text-foreground',
                            'has-[input[type=checkbox]]:list-none has-[input[type=checkbox]]:space-y-2 has-[input[type=checkbox]]:pl-0',
                            className,
                        )}
                        {...props}
                    >
                        {children}
                    </ul>
                ),
                ol: ({ children, className, ...props }) => (
                    <ol
                        className={cn('my-3 text-left list-outside list-decimal space-y-1 pl-5 text-foreground', className)}
                        {...props}
                    >
                        {children}
                    </ol>
                ),
                li: ({ children, ...props }) => (
                    <li
                        className={cn(
                            'leading-relaxed text-foreground marker:text-foreground',
                            '[&_p:not(:last-child)]:mb-2 [&_ul]:mt-2 [&_ol]:mt-2',
                            '[&:has(input[type=checkbox])]:flex [&:has(input[type=checkbox])]:items-start [&:has(input[type=checkbox])]:gap-2',
                        )}
                        {...props}
                    >
                        {children}
                    </li>
                ),
                // Custom code block styling
                code: ({ node, className, children, ...props }) => {
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
                    <div
                        role="button"
                        className="cursor-pointer text-primary hover:underline"
                        onClick={() => linkCallback(`${children} (${href ?? ''})`)}
                    >
                        {children}
                    </div>
                ),
            }}
        >
            {content}
        </ReactMarkdown>
    </div>
)

// Assistant Message Component - appears on the left
const AssistantMessage: React.FC<{ content: string; isStreaming?: boolean; linkCallback: (content: string) => void }> = ({
    content,
    isStreaming,
    linkCallback
}) => (
    <div className="relative w-full animate-fade-in">
        <div className="py-1">
            {isStreaming ? (
                <StreamingText content={content} />
            ) : (
                <Markdown content={content} linkCallback={linkCallback} />
            )}
        </div>
    </div>
)

// Loading indicator
const LoadingIndicator: React.FC = () => {
    const [isVisible, setIsVisible] = useState(false)

    useEffect(() => {
        setIsVisible(true)
    }, [])

    return (
        <div
            className={cn(
                'p-4 transition-transform duration-300 ease-in-out',
                isVisible ? 'scale-100' : 'scale-0'
            )}
        >
            <BlueberryLogoMark
                size={30}
                speed={5}
                className=""
            />
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

    const handleSubmit = () => {
        if (value.trim() && !disabled) {
            onSend(value.trim())
            setValue('')
            // Reset textarea height
            if (textareaRef.current) {
                textareaRef.current.style.height = '24px'
            }
        }
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            handleSubmit()
        }
    }

    return (
        <div className={cn(
            "mx-auto max-w-lg w-full border p-3 rounded-3xl bg-background dark:bg-secondary",
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
    user?: Message
    assistant?: Message
}

const ConversationTurnComponent: React.FC<{
    turn: ConversationTurn
    isLoading?: boolean
    linkCallback: (content: string) => void
}> = ({ turn, isLoading, linkCallback }) => (
    <div className="pt-12 flex flex-col gap-8">
        {turn.user && <UserMessage content={turn.user.content} />}
        {turn.assistant && (
            <AssistantMessage
                content={turn.assistant.content}
                isStreaming={turn.assistant.isStreaming}
                linkCallback={linkCallback}
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
    const { scrollContainerRef, contentRef } = useChatAutoScroll(messages)

    // Group messages into conversation turns
    const conversationTurns: ConversationTurn[] = []
    for (let i = 0; i < messages.length; i++) {
        if (messages[i].role === 'user') {
            const turn: ConversationTurn = { user: messages[i] }
            if (messages[i + 1]?.role === 'assistant') {
                turn.assistant = messages[i + 1]
                i++ // Skip next message since we've paired it
            }
            conversationTurns.push(turn)
        } else if (messages[i].role === 'assistant' &&
            (i === 0 || messages[i - 1]?.role !== 'user')) {
            // Handle standalone assistant messages
            conversationTurns.push({ assistant: messages[i] })
        }
    }

    // Check if we need to show loading after the last turn
    const showLoadingAfterLastTurn = isLoading &&
        messages[messages.length - 1]?.role === 'user'

    const linkCallback = (content: string) => {
        sendMessage(`${content}`);
    }

    return (
        <div className={cn("h-full flex flex-col bg-background", messages.length === 0 ? "justify-center" : "")}>
            {/* Messages Area */}
            <div
                ref={scrollContainerRef}
                className={cn("flex-1 overflow-y-auto pb-4", messages.length === 0 ? "max-h-40" : "")}
            >
                <div className="h-8 mx-auto px-4">
                    {/* New Chat Button - Floating */}
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

                <div ref={contentRef} className="pb-4 relative max-w-lg mx-auto">

                    {messages.length === 0 ? (
                        // Empty State
                        <div className="flex items-center justify-center h-full">
                            <div className="text-center animate-fade-in max-w-md mx-auto gap-2 flex flex-col items-center">
                                <BlueberryLogoMark className="text-foreground" size={70} />
                            </div>
                        </div>
                    ) : (
                        <>

                            {/* Render conversation turns */}
                            {conversationTurns.map((turn, index) => (
                                <ConversationTurnComponent
                                    key={`turn-${index}`}
                                    turn={turn}
                                    isLoading={
                                        showLoadingAfterLastTurn &&
                                        index === conversationTurns.length - 1
                                    }
                                    linkCallback={linkCallback}
                                />
                            ))}
                        </>
                    )}
                </div>
            </div>

            {/* Input Area */}
            <div className="p-4">
                <ChatInput onSend={sendMessage} disabled={isLoading} />
            </div>
        </div>
    )
}