import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import Logo from '@/components/Logo';

const NAV = [
    { label: 'Features', href: '/#features' },
    { label: 'How it works', href: '/#how' },
    { label: 'Pricing', href: '/#pricing' },
    { label: 'Customers', href: '/#testimonials' },
];

export default function SiteHeader() {
    const { isAuthed } = useAuth();
    const [open, setOpen] = useState(false);

    return (
        <header className="fixed inset-x-0 top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-md">
            <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
                <Logo />

                <nav className="hidden items-center gap-7 md:flex">
                    {NAV.map((item) => (
                        <a key={item.href} href={item.href} className="text-sm text-muted-foreground transition-colors hover:text-foreground">
                            {item.label}
                        </a>
                    ))}
                </nav>

                <div className="hidden items-center gap-3 md:flex">
                    {isAuthed ? (
                        <Link to="/dashboard" className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-transform hover:brightness-110 active:scale-[0.98]">
                            Open Dashboard
                        </Link>
                    ) : (
                        <>
                            <Link to="/login" className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
                                Sign in
                            </Link>
                            <Link to="/signup" className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-all hover:brightness-110 active:scale-[0.98]">
                                Start Free Trial
                            </Link>
                        </>
                    )}
                </div>

                <button className="flex h-10 w-10 items-center justify-center rounded-lg border border-border md:hidden" onClick={() => setOpen(!open)} aria-label="Toggle menu">
                    {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
                </button>
            </div>

            {open && (
                <div className="border-t border-border bg-background px-5 py-4 md:hidden">
                    <nav className="flex flex-col gap-3">
                        {NAV.map((item) => (
                            <a key={item.href} href={item.href} onClick={() => setOpen(false)} className="py-1.5 text-sm text-muted-foreground">
                                {item.label}
                            </a>
                        ))}
                        <Link to={isAuthed ? '/dashboard' : '/signup'} className="mt-2 rounded-lg bg-primary px-4 py-2.5 text-center text-sm font-semibold text-primary-foreground">
                            {isAuthed ? 'Open Dashboard' : 'Start Free Trial'}
                        </Link>
                        {!isAuthed && (
                            <Link to="/login" className="py-1.5 text-center text-sm text-muted-foreground">
                                Sign in
                            </Link>
                        )}
                    </nav>
                </div>
            )}
        </header>
    );
}
