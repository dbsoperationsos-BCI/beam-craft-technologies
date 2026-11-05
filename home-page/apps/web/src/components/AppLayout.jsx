import React from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Settings, Shield, LogOut } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import Logo from '@/components/Logo';

export default function AppLayout() {
    const { user, logout } = useAuth();
    const navigate = useNavigate();

    const onLogout = () => {
        logout();
        navigate('/');
    };

    const linkCls = ({ isActive }) =>
        `flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${isActive ? 'bg-primary/10 text-beam' : 'text-muted-foreground hover:text-foreground'}`;

    return (
        <div className="min-h-[100dvh] bg-background text-foreground">
            <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-md">
                <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
                    <div className="flex items-center gap-8">
                        <Logo />
                        <nav className="hidden items-center gap-1 sm:flex">
                            <NavLink to="/dashboard" className={linkCls}><LayoutDashboard className="h-4 w-4" /> Dashboard</NavLink>
                            <NavLink to="/settings" className={linkCls}><Settings className="h-4 w-4" /> Settings</NavLink>
                            {user?.role === 'admin' && <NavLink to="/admin" className={linkCls}><Shield className="h-4 w-4" /> Admin</NavLink>}
                        </nav>
                    </div>
                    <div className="flex items-center gap-3">
                        <span className="hidden max-w-[180px] truncate text-sm text-muted-foreground md:block">{user?.email}</span>
                        <button onClick={onLogout} className="flex h-10 items-center gap-2 rounded-lg border border-border px-3 text-sm text-muted-foreground transition-colors hover:border-destructive/50 hover:text-destructive">
                            <LogOut className="h-4 w-4" /> <span className="hidden sm:inline">Log out</span>
                        </button>
                    </div>
                </div>
                <nav className="flex items-center gap-1 overflow-x-auto border-t border-border px-5 py-2 sm:hidden">
                    <NavLink to="/dashboard" className={linkCls}><LayoutDashboard className="h-4 w-4" /> Dashboard</NavLink>
                    <NavLink to="/settings" className={linkCls}><Settings className="h-4 w-4" /> Settings</NavLink>
                    {user?.role === 'admin' && <NavLink to="/admin" className={linkCls}><Shield className="h-4 w-4" /> Admin</NavLink>}
                </nav>
            </header>
            <main className="mx-auto max-w-6xl px-5 py-10">
                <Outlet />
            </main>
        </div>
    );
}
