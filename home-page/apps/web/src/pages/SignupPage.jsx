import React, { useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import Logo from '@/components/Logo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function SignupPage() {
    const { signup } = useAuth();
    const navigate = useNavigate();
    const [form, setForm] = useState({ name: '', company: '', email: '', password: '' });
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

    const submit = async (e) => {
        e.preventDefault();
        setError('');
        if (form.password.length < 10) {
            setError('Password must be at least 10 characters.');
            return;
        }
        setBusy(true);
        try {
            await signup(form.email, form.password, { name: form.name, company: form.company, plan: 'trial', role: 'member' });
            navigate('/dashboard');
        } catch (err) {
            setError(err?.message || 'Sign-up failed. Please try again.');
            setBusy(false);
        }
    };

    return (
        <div className="flex min-h-[100dvh] items-center justify-center bg-background px-5 py-16 text-foreground">
            <Helmet>
                <title>Start Your Free Trial — BeamCraft</title>
                <meta name="description" content="Create your BeamCraft account and start a 14-day free trial of the platform." />
            </Helmet>
            <div className="beam-glow pointer-events-none absolute inset-0" aria-hidden="true" />
            <div className="relative w-full max-w-md">
                <div className="mb-8 flex justify-center">
                    <Logo size={36} />
                </div>
                <form onSubmit={submit} className="space-y-5 rounded-2xl border border-border bg-card p-8">
                    <div className="text-center">
                        <h1 className="font-display text-2xl font-bold">Start your free trial</h1>
                        <p className="mt-1.5 text-sm text-muted-foreground">14 days, full platform, no credit card.</p>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="su-name">Full name</Label>
                        <Input id="su-name" required value={form.name} onChange={set('name')} className="bg-background" />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="su-company">Company name</Label>
                        <Input id="su-company" required value={form.company} onChange={set('company')} className="bg-background" />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="su-email">Work email</Label>
                        <Input id="su-email" type="email" required value={form.email} onChange={set('email')} className="bg-background" />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="su-pass">Password</Label>
                        <Input id="su-pass" type="password" required minLength={10} value={form.password} onChange={set('password')} className="bg-background" />
                        <p className="text-xs text-muted-foreground">Minimum 10 characters.</p>
                    </div>
                    {error && <p className="text-sm text-destructive">{error}</p>}
                    <Button type="submit" disabled={busy} className="h-12 w-full bg-primary text-sm font-semibold text-primary-foreground hover:brightness-110">
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create account'}
                    </Button>
                    <p className="text-center text-sm text-muted-foreground">
                        Already have an account? <Link to="/login" className="font-medium text-beam hover:underline">Sign in</Link>
                    </p>
                </form>
            </div>
        </div>
    );
}
