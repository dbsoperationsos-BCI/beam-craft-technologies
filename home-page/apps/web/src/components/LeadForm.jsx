import React, { useState } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import pb from '@/lib/pocketbaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export default function LeadForm({ type }) {
    const isDemo = type === 'demo';
    const [form, setForm] = useState({ name: '', email: '', company: '', message: '', preferred_time: '' });
    const [status, setStatus] = useState('idle'); // idle | sending | done | error
    const [error, setError] = useState('');

    const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

    const submit = async (e) => {
        e.preventDefault();
        setStatus('sending');
        setError('');
        try {
            await pb.collection('leads').create({ type, ...form, status: 'new' });
            setStatus('done');
        } catch (err) {
            setStatus('error');
            setError(err?.message || 'Something went wrong. Please try again.');
        }
    };

    if (status === 'done') {
        return (
            <div className="rounded-2xl border border-primary/40 bg-primary/5 p-10 text-center">
                <CheckCircle2 className="mx-auto h-12 w-12 text-beam" strokeWidth={1.5} />
                <h2 className="mt-4 font-display text-2xl font-semibold">Request received</h2>
                <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
                    Thanks, {form.name.split(' ')[0] || 'there'} — we've emailed a confirmation to {form.email}. Our team responds within one business day.
                </p>
            </div>
        );
    }

    return (
        <form onSubmit={submit} className="space-y-5 rounded-2xl border border-border bg-card p-7 md:p-9">
            <div className="grid gap-5 sm:grid-cols-2">
                <div className="space-y-2">
                    <Label htmlFor="lf-name">Full name</Label>
                    <Input id="lf-name" required value={form.name} onChange={set('name')} placeholder="Alex Rivera" className="bg-background" />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="lf-email">Work email</Label>
                    <Input id="lf-email" type="email" required value={form.email} onChange={set('email')} placeholder="alex@company.com" className="bg-background" />
                </div>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
                <div className="space-y-2">
                    <Label htmlFor="lf-company">Company</Label>
                    <Input id="lf-company" required value={form.company} onChange={set('company')} placeholder="Company Inc." className="bg-background" />
                </div>
                {isDemo && (
                    <div className="space-y-2">
                        <Label htmlFor="lf-time">Preferred time</Label>
                        <Input id="lf-time" value={form.preferred_time} onChange={set('preferred_time')} placeholder="e.g. Tue 14:00–16:00 CET" className="bg-background" />
                    </div>
                )}
            </div>
            <div className="space-y-2">
                <Label htmlFor="lf-msg">{isDemo ? 'What use case should we focus on?' : 'Project details'}</Label>
                <Textarea
                    id="lf-msg"
                    required
                    rows={5}
                    value={form.message}
                    onChange={set('message')}
                    placeholder={isDemo ? 'Tell us about the workflow or decision you want to improve…' : 'Scope, timeline, team size, systems to integrate…'}
                    className="bg-background"
                />
            </div>
            {status === 'error' && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={status === 'sending'} className="h-12 w-full bg-primary text-sm font-semibold text-primary-foreground hover:brightness-110">
                {status === 'sending' ? <Loader2 className="h-4 w-4 animate-spin" /> : isDemo ? 'Book my demo' : 'Request my quote'}
            </Button>
            <p className="text-center text-xs text-muted-foreground">A confirmation email is sent immediately after submission.</p>
        </form>
    );
}
