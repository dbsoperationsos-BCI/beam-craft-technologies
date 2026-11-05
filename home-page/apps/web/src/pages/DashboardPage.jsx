import React, { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link } from 'react-router-dom';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Activity, Bot, Layers, ArrowUpRight } from 'lucide-react';
import pb from '@/lib/pocketbaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

const PLAN_LABELS = { trial: 'Free Trial', growth: 'Growth', enterprise: 'Enterprise' };

export default function DashboardPage() {
    const { user } = useAuth();
    const { toast } = useToast();
    const [usage, setUsage] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        pb.collection('usage_snapshots')
            .getFullList({ sort: 'created' })
            .then(setUsage)
            .catch(() => {})
            .finally(() => setLoading(false));
    }, []);

    const latest = usage[usage.length - 1] || {};
    const plan = user?.plan || 'trial';

    const requestEnterprise = async () => {
        try {
            await pb.collection('leads').create({
                type: 'enterprise',
                name: user?.name || user?.email,
                email: user?.email,
                company: user?.company || '—',
                message: 'Enterprise upgrade request from dashboard.',
                status: 'new',
            });
            toast({ title: 'Request sent', description: 'Our team will contact you within one business day.' });
        } catch {
            toast({ title: 'Could not send request', variant: 'destructive' });
        }
    };

    const stats = [
        { icon: Activity, label: 'Operations this month', value: (latest.operations || 0).toLocaleString() },
        { icon: Bot, label: 'Active automations', value: (latest.automations || 0).toLocaleString() },
        { icon: Layers, label: 'Applications live', value: latest.active_apps ?? 0 },
    ];

    return (
        <div>
            <Helmet>
                <title>Dashboard — BeamCraft</title>
                <meta name="description" content="Your BeamCraft workspace: usage metrics, plan, and account overview." />
            </Helmet>
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                    <h1 className="font-display text-3xl font-bold tracking-tight">Welcome back{user?.name ? `, ${user.name.split(' ')[0]}` : ''}</h1>
                    <p className="mt-1 text-sm text-muted-foreground">{user?.company || 'Your workspace'}</p>
                </div>
                <span className="rounded-full border border-primary/40 bg-primary/10 px-4 py-1.5 text-sm font-semibold text-beam">
                    {PLAN_LABELS[plan] || plan} plan
                </span>
            </div>

            <div className="mt-8 grid gap-4 sm:grid-cols-3">
                {stats.map((s) => (
                    <div key={s.label} className="rounded-2xl border border-border bg-card p-6">
                        <s.icon className="h-5 w-5 text-beam" strokeWidth={1.8} />
                        <p className="mt-3 font-display text-3xl font-bold">{loading ? '—' : s.value}</p>
                        <p className="mt-1 text-sm text-muted-foreground">{s.label}</p>
                    </div>
                ))}
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
                <div className="rounded-2xl border border-border bg-card p-6">
                    <h2 className="font-display text-lg font-semibold">Usage trend</h2>
                    <p className="text-sm text-muted-foreground">Operations per month — your bill follows this curve.</p>
                    <div className="mt-5 h-64">
                        {loading ? (
                            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading usage…</div>
                        ) : usage.length === 0 ? (
                            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No usage recorded yet — it appears as your applications run.</div>
                        ) : (
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={usage} margin={{ top: 5, right: 5, bottom: 0, left: -14 }}>
                                    <defs>
                                        <linearGradient id="ops" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor="hsl(0 84% 51%)" stopOpacity={0.4} />
                                            <stop offset="100%" stopColor="hsl(0 84% 51%)" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <XAxis dataKey="month" stroke="hsl(215 16% 47%)" fontSize={12} tickLine={false} axisLine={false} />
                                    <YAxis stroke="hsl(215 16% 47%)" fontSize={12} tickLine={false} axisLine={false} />
                                    <Tooltip contentStyle={{ background: 'hsl(0 0% 100%)', border: '1px solid hsl(214 32% 91%)', borderRadius: 12, fontSize: 13, color: 'hsl(224 47% 11%)' }} />
                                    <Area type="monotone" dataKey="operations" stroke="hsl(0 84% 51%)" strokeWidth={2} fill="url(#ops)" />
                                </AreaChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                </div>

                <div className="flex flex-col gap-6">
                    <div className="rounded-2xl border border-border bg-card p-6">
                        <h2 className="font-display text-lg font-semibold">Current tier</h2>
                        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                            {plan === 'trial' && 'You are on the 14-day free trial. Upgrade to Growth for usage-based billing with no seat limits.'}
                            {plan === 'growth' && 'You are on usage-based Growth billing. Enterprise adds SSO, audit logs, and volume pricing.'}
                            {plan === 'enterprise' && 'You are on an Enterprise agreement with dedicated engineering support.'}
                        </p>
                        {plan !== 'enterprise' && (
                            <button onClick={requestEnterprise} className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-all hover:brightness-110 active:scale-[0.98]">
                                Request enterprise features <ArrowUpRight className="h-4 w-4" />
                            </button>
                        )}
                    </div>
                    <div className="rounded-2xl border border-border bg-card p-6">
                        <h2 className="font-display text-lg font-semibold">Quick actions</h2>
                        <div className="mt-3 flex flex-col gap-2 text-sm">
                            <Link to="/settings" className="rounded-lg border border-border px-4 py-2.5 transition-colors hover:border-primary/50 hover:text-beam">Manage account settings</Link>
                            <Link to="/demo" className="rounded-lg border border-border px-4 py-2.5 transition-colors hover:border-primary/50 hover:text-beam">Book a solutions demo</Link>
                            <Link to="/quote" className="rounded-lg border border-border px-4 py-2.5 transition-colors hover:border-primary/50 hover:text-beam">Request a new project quote</Link>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
