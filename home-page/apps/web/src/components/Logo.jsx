import React from 'react';
import { Link } from 'react-router-dom';

/**
 * BeamCraft logo — black wordmark with a red play/arrow icon.
 * `size` controls the icon box; wordmark scales with it.
 */
export default function Logo({ to = '/', size = 32, className = '' }) {
    const text = size >= 36 ? 'text-xl' : 'text-lg';
    return (
        <Link to={to} className={`flex items-center gap-2 ${className}`}>
            <span
                className="relative flex shrink-0 items-center justify-center"
                style={{ width: size, height: size }}
                aria-hidden="true"
            >
                <svg viewBox="0 0 32 32" width={size} height={size} fill="none" xmlns="http://.w3.org/2000/svg">
                    <path
                        d="M7 5.5C7 4.7 7.9 4.2 8.6 4.6L25 15.1C25.7 15.5 25.7 16.5 25 16.9L8.6 27.4C7.9 27.8 7 27.3 7 26.5V5.5Z"
                        fill="hsl(var(--primary))"
                    />
                </svg>
            </span>
            <span className={`font-display ${text} font-bold tracking-tight text-foreground`}>
                Beam<span className="text-foreground">Craft</span>
            </span>
        </Link>
    );
}
