import React, { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import pb from '@/lib/pocketbaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

function LeadsTab() {
    const { toast } = useToast();
    const [leads, setLeads] = useState(null);

    useEffect(() => {
        pb.collection('leads').getFullList({ sort: '-created' }).then(setLeads).catch(() => setLeads([]));
    }, []);

    const setStatus = async (id, status) => {
        try {
            const rec = await pb.collection('leads').update(id, { status });
            setLeads((prev) => prev.map((l) => (l.id === id ? rec : l)));
        } catch {
            toast({ title: 'Status update failed', variant: 'destructive' });
        }
    };

    if (leads === null) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-beam" /></div>;
    if (leads.length === 0) return <p className="rounded-2xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">No leads yet — demo, quote, and enterprise requests will appear here.</p>;

    return (
        <div className="overflow-x-auto rounded-2xl border border-border">
            <table className="w-full min-w-[720px] text-sm">
                <thead>
                    <tr className="border-b border-border bg-card text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-4 py-3">Type</th><th className="px-4 py-3">Name</th><th className="px-4 py-3">Email</th><th className="px-4 py-3">Company</th><th className="px-4 py-3">Message</th><th className="px-4 py-3">Received</th><th className="px-4 py-3">Status</th>
                    </tr>
                </thead>
                <tbody>
                    {leads.map((l) => (
                        <tr key={l.id} className="border-b border-border/60 align-top last:border-0">
                            <td className="px-4 py-3"><span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-beam">{l.type}</span></td>
                            <td className="px-4 py-3 font-medium">{l.name}</td>
                            <td className="px-4 py-3 text-muted-foreground">{l.email}</td>
                            <td className="px-4 py-3">{l.company}</td>
                            <td className="max-w-[240px] px-4 py-3 text-muted-foreground"><span className="line-clamp-2">{l.message}{l.preferred_time ? ` — Pref: ${l.preferred_time}` : ''}</span></td>
                            <td className="px-4 py-3 text-muted-foreground">{new Date(l.created).toLocaleDateString()}</td>
                            <td className="px-4 py-3">
                                <Select value={l.status || 'new'} onValueChange={(v) => setStatus(l.id, v)}>
                                    <SelectTrigger className="h-9 w-32 bg-background"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="new">New</SelectItem>
                                        <SelectItem value="contacted">Contacted</SelectItem>
                                        <SelectItem value="closed">Closed</SelectItem>
                                    </SelectContent>
                                </Select>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function ContentTab() {
    const { toast } = useToast();
    const [records, setRecords] = useState(null);
    const [drafts, setDrafts] = useState({});
    const [saving, setSaving] = useState('');

    useEffect(() => {
        pb.collection('site_content').getFullList({ sort: 'key' }).then((recs) => {
            setRecords(recs);
            const d = {};
            recs.forEach((r) => { d[r.id] = JSON.stringify(r.value, null, 2); });
            setDrafts(d);
        }).catch(() => setRecords([]));
    }, []);

    const save = async (rec) => {
        setSaving(rec.id);
        try {
            const value = JSON.parse(drafts[rec.id]);
            await pb.collection('site_content').update(rec.id, { value });
            toast({ title: `"${rec.label || rec.key}" saved`, description: 'The marketing site now shows the updated content.' });
        } catch (err) {
            toast({ title: err?.message?.includes('JSON') ? 'Invalid JSON — check the syntax' : 'Save failed', variant: 'destructive' });
        } finally {
            setSaving('');
        }
    };

    if (records === null) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-beam" /></div>;

    return (
        <div className="space-y-6">
            <p className="text-sm text-muted-foreground">Edit the marketing site's copy as JSON. Changes go live immediately — no code deploy needed.</p>
            {records.map((r) => (
                <div key={r.id} className="rounded-2xl border border-border bg-card p-6">
                    <div className="flex items-center justify-between gap-4">
                        <div>
                            <h3 className="font-display font-semibold">{r.label || r.key}</h3>
                            <p className="text-xs text-muted-foreground">key: {r.key}</p>
                        </div>
                        <Button onClick={() => save(r)} disabled={saving === r.id} className="bg-primary font-semibold text-primary-foreground hover:brightness-110">
                            {saving === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
                        </Button>
                    </div>
                    <Textarea
                        value={drafts[r.id] || ''}
                        onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: e.target.value }))}
                        rows={Math.min(14, (drafts[r.id] || '').split('\n').length + 1)}
                        className="mt-4 bg-background font-mono text-xs"
                        spellCheck={false}
                    />
                </div>
            ))}
        </div>
    );
}

export default function AdminPage() {
    const { user } = useAuth();
    if (user?.role !== 'admin') return <Navigate to="/dashboard" replace />;

    return (
        <div>
            <Helmet>
                <title>Admin — BeamCraft</title>
                <meta name="description" content="BeamCraft team admin: manage leads and site content." />
            </Helmet>
            <h1 className="font-display text-3xl font-bold tracking-tight">Team admin</h1>
            <p className="mt-1 text-sm text-muted-foreground">Manage incoming leads and edit marketing content.</p>
            <Tabs defaultValue="leads" className="mt-8">
                <TabsList>
                    <TabsTrigger value="leads">Leads</TabsTrigger>
                    <TabsTrigger value="content">Site content</TabsTrigger>
                </TabsList>
                <TabsContent value="leads" className="mt-6"><LeadsTab /></TabsContent>
                <TabsContent value="content" className="mt-6"><ContentTab /></TabsContent>
            </Tabs>
        </div>
    );
}
