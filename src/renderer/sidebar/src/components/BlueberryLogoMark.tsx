import React, { useEffect, useRef } from 'react'
import { cn } from '@common/lib/utils'

/**
 * Path geometry in document order — keep identical to `/logo.svg` in the repo root.
 */
const VIEWBOX_W = 23.32
const VIEWBOX_H = 24

/** Subtle fills: visible against scrim but intentionally muted. */
export const BLUEBERRY_LOGO_LOADING_FILL_LIGHT = '#b8bec9'
export const BLUEBERRY_LOGO_LOADING_FILL_DARK = '#555'

export interface BlueberryLogoMarkProps {
    className?: string;
    size?: number;
    speed?: number;
    'aria-hidden'?: boolean;
}

export const BlueberryLogoMark: React.FC<BlueberryLogoMarkProps> = ({
    className,
    speed = 1,
    size = 40,
    'aria-hidden': ariaHidden = true,
}) => {
    const height = (size * VIEWBOX_H) / VIEWBOX_W

    const svgRef = useRef<SVGSVGElement>(null);
    useEffect(() => {
        const paths = svgRef.current?.querySelectorAll('path');
        if (!paths) return;
        
        let index = 0;
        let stepId : NodeJS.Timeout;
        function step() {
            index++;
            if (index >= paths!.length) {
                index = 0;
            }
            paths?.forEach((path, i) => {
                if (i === index) {
                    path.style.opacity = '0.4';
                } else {
                    path.style.opacity = '0.2';
                }
                path.style.transition = `opacity 100ms ease-in-out`;
            });
            stepId = setTimeout(step, 1000 / speed);
        }

        step();
        return () => {
            clearTimeout(stepId);
        };
    }, []);

    return (
        <svg
            ref={svgRef}
            xmlns="http://www.w3.org/2000/svg"
            width={size}
            height={height}
            viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
            fill="currentColor"
            className={cn('shrink-0', className)}
            aria-hidden={ariaHidden}
        >
            <path d="M 14.122,0 H 9.199 v 5.087 h 4.923 z" />
            <path d="m 7.19,10.304 c 1.467,0 2.656,-1.226 2.656,-2.739 0,-1.513 -1.189,-2.739 -2.656,-2.739 -1.466,0 -2.656,1.226 -2.656,2.74 0,1.512 1.19,2.738 2.656,2.738 z" />
            <path d="m 16.195,10.304 a 2.73,2.73 0 0 0 2.72,-2.739 2.73,2.73 0 0 0 -2.72,-2.739 2.73,2.73 0 0 0 -2.721,2.74 2.73,2.73 0 0 0 2.72,2.738 z" />
            <path d="m 2.72,14.87 c 1.503,0 2.721,-1.197 2.721,-2.674 0,-1.477 -1.218,-2.674 -2.72,-2.674 C 1.218,9.522 0,10.719 0,12.196 0,13.672 1.218,14.87 2.72,14.87 Z" />
            <path d="M 14.122,9.652 H 9.199 v 4.957 h 4.923 z" />
            <path d="m 20.6,14.87 c 1.502,0 2.72,-1.197 2.72,-2.674 0,-1.477 -1.218,-2.674 -2.72,-2.674 -1.503,0 -2.721,1.197 -2.721,2.674 0,1.476 1.218,2.674 2.72,2.674 z" />
            <path d="M 7.19,19.435 A 2.665,2.665 0 0 0 9.846,16.761 2.665,2.665 0 0 0 7.19,14.087 2.665,2.665 0 0 0 4.534,16.761 2.665,2.665 0 0 0 7.19,19.435 Z" />
            <path d="m 16.195,19.435 c 1.502,0 2.72,-1.197 2.72,-2.674 0,-1.477 -1.218,-2.674 -2.72,-2.674 -1.503,0 -2.721,1.197 -2.721,2.674 0,1.477 1.218,2.674 2.72,2.674 z" />
            <path d="M 11.66,24 A 2.73,2.73 0 0 0 14.38,21.26 2.73,2.73 0 0 0 11.66,18.522 2.73,2.73 0 0 0 8.94,21.261 2.73,2.73 0 0 0 11.66,24 Z" />
        </svg>
    )
}
