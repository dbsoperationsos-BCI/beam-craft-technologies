import React, { useState } from 'react';
import { Helmet } from 'react-helmet';
import { Loader2 } from 'lucide-react';
import pb from '@/lib/pocketbaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function SettingsPage() {
    const { user } = useAuth();
    const { toast } = useToast();
    const [profile, setProfile] = useState({ name: user?.name || '', company: user?.company || '' });
    const [pw, setPw] = useState({ oldPassword: '', password: '', passwordConfirm: '' });
    const [busy, setBusy] = useState(false);

    const saveProfile = async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
            await pb.collection('users').update(user.id, profile);
            toast({ title: 'Profile updated' });
        } catch {
            toast({ title: 'Update failed', variant: 'destructive' });
        } finally {
            setBusy(false);
        }
    };

    const changePassword = async (e) => {
        e.preventDefault();
        if (pw.password.length < 10) {
            toast({ title: 'Password must be at least 10 characters', variant: 'destructive' });
            return;
        }
        if (pw.password !== pw.passwordConfirm) {
            toast({ title: 'Passwords do not match', variant: 'destructive' });
            return;
        }
        setBusy(true);
        try {
            await pb.collection('users').update(user.id, pw);
            setPw({ oldPassword: '', password: '', passwordConfirm: '' });
            toast({ title: 'Password changed' });
        } catch {
            toast({ title: 'Password change failed — check your current password', variant: 'destructive' });
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="max-w-2xl">
            <Helmet>
                <title>Account Settings — BeamCraft</title>
                <meta name="description" content="Manage your BeamCraft account profile and password." />
            </Helmet>
            <h1 className="font-display text-3xl font-bold tracking-tight">Account settings</h1>
            <p className="mt-1 text-sm text-muted-foreground">{user?.email}</p>

            <form onSubmit={saveProfile} className="mt-8 space-y-5 rounded-2xl border border-border bg-card p-7">
                <h2 className="font-display text-lg font-semibold">Profile</h2>
                <div className="space-y-2">
                    <Label htmlFor="st-name">Full name</Label>
                    <Input id="st-name" value={profile.name} onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))} className="bg-background" />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="st-company">Company</Label>
                    <Input id="st-company" value={profile.company} onChange={(e) => setProfile((p) => ({ ...p, company: e.target.value }))} className="bg-background" />
                </div>
                <Button type="submit" disabled={busy} className="bg-primary font-semibold text-primary-foreground hover:brightness-110">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save profile'}
                </Button>
            </form>

            <form onSubmit={changePassword} className="mt-6 space-y-5 rounded-2xl border border-border bg-card p-7">
                <h2 className="font-display text-lg font-semibold">Change password</h2>
                <div className="space-y-2">
                    <Label htmlFor="st-old">Current password</Label>
                    <Input id="st-old" type="password" required value={pw.oldPassword} onChange={(e) => setPw((p) => ({ ...p, oldPassword: e.target.value }))} className="bg-background" />
                </div>
                <div className="grid gap-5 sm:grid-cols-2">
                    <div className="space-y-2">
                        <Label htmlFor="st-new">New password</Label>
                        <Input id="st-new" type="password" required minLength={10} value={pw.password} onChange={(e) => setPw((p) => ({ ...p, password: e.target.value }))} className="bg-background" />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="st-confirm">Confirm new password</Label>
                        <Input id="st-confirm" type="password" required value={pw.passwordConfirm} onChange={(e) => setPw((p) => ({ ...p, passwordConfirm: e.target.value }))} className="bg-background" />
                    </div>
                </div>
                <Button type="submit" disabled={busy} variant="outline" className="font-semibold">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Change password'}
                </Button>
            </form>
        </div>
    );
}
