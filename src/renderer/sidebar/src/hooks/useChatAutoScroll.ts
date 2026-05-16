import { useEffect, useLayoutEffect, useRef } from 'react';

const NEAR_BOTTOM_PX = 80;

// Keeps a scroll region pinned to the bottom on transcript updates unless the user scrolled up.
export function useChatAutoScroll<T>(messages: readonly T[]) {
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const stickToBottomRef = useRef(true);
    const prevLengthRef = useRef(0);

    useEffect(() => {
        const el = scrollContainerRef.current;
        if (!el) return;

        const onScroll = () => {
            const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
            stickToBottomRef.current = distanceFromBottom < NEAR_BOTTOM_PX;
        }

        el.addEventListener('scroll', onScroll, { passive: true })
        return () => el.removeEventListener('scroll', onScroll);
    }, [])

    useLayoutEffect(() => {
        const el = scrollContainerRef.current;
        if (!el) {
            return;
        }

        if (messages.length === 0) {
            prevLengthRef.current = 0;
            return;
        }

        const countIncreased = messages.length > prevLengthRef.current;
        prevLengthRef.current = messages.length;

        if (!(countIncreased || stickToBottomRef.current)) {
            return;
        }

        const applyScroll = () => {
            const container = scrollContainerRef.current;
            if (!container) return;
            container.scrollTop = container.scrollHeight;
        }

        applyScroll();
        requestAnimationFrame(applyScroll);
    }, [messages]);

    useEffect(() => {
        const outer = scrollContainerRef.current;
        const inner = contentRef.current;
        if (!outer || !inner) return;

        const ro = new ResizeObserver(() => {
            if (!stickToBottomRef.current) return;
            outer.scrollTop = outer.scrollHeight;
        })

        ro.observe(inner);
        return () => ro.disconnect();
    }, [])

    return { scrollContainerRef, contentRef };
}
