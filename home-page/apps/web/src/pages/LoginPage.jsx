import React, { useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import Logo from '@/components/Logo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function LoginPage() {
    const { login } = useAuth();
    const navigate = useNavigate();
    const [form, setForm] = useState({ email: '', password: '' });
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

    const submit = async (e) => {
        e.preventDefault();
        setError('');
        setBusy(true);
        try {
            await login(form.email, form.password);
            navigate('/dashboard');
        } catch {
            setError('Invalid email or password.');
            setBusy(false);
        }
    };

    return (
        <div className="flex min-h-[100dvh] items-center justify-center bg-background px-5 py-16 text-foreground">
            <Helmet>
                <title>Sign In — BeamCraft</title>
                <meta name="description" content="Sign in to your BeamCraft workspace." />
            </Helmet>
            <div className="beam-glow pointer-events-none absolute inset-0" aria-hidden="true" />
            <div className="relative w-full max-w-md">
                <div className="mb-8 flex justify-center">
                    <Logo size={36} />
                </div>
                <form onSubmit={submit} className="space-y-5 rounded-2xl border border-border bg-card p-8">
                    <div className="text-center">
                        <h1 className="font-display text-2xl font-bold">Welcome back</h1>
                        <p className="mt-1.5 text-sm text-muted-foreground">Sign in to your workspace.</p>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="li-email">Email</Label>
                        <Input id="li-email" type="email" required value={form.email} onChange={set('email')} className="bg-background" />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="li-pass">Password</Label>
                        <Input id="li-pass" type="password" required value={form.password} onChange={set('password')} className="bg-background" />
                    </div>
                    {error && <p className="text-sm text-destructive">{error}</p>}
                    <Button type="submit" disabled={busy} className="h-12 w-full bg-primary text-sm font-semibold text-primary-foreground hover:brightness-110">
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Sign in'}
                    </Button>
                    <p className="text-center text-sm text-muted-foreground">
                        No account yet? <Link to="/signup" className="font-medium text-beam hover:underline">Start a free trial</Link>
                    </p>
                </form>
            </div>
        </div>
    );
}
