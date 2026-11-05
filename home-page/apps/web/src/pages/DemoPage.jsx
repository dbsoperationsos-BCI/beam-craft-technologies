import React from 'react';
import { Helmet } from 'react-helmet';
import SiteHeader from '@/components/marketing/SiteHeader';
import SiteFooter from '@/components/marketing/SiteFooter';
import LeadForm from '@/components/LeadForm';

export default function DemoPage() {
    return (
        <div className="min-h-screen bg-background text-foreground">
            <Helmet>
                <title>Book a Demo — BeamCraft</title>
                <meta name="description" content="Book a personalized BeamCraft demo. See how customized next-gen applications fit your operation." />
            </Helmet>
            <SiteHeader />
            <main className="relative mx-auto max-w-2xl px-5 pt-32 pb-24">
                <div className="beam-glow absolute inset-0" aria-hidden="true" />
                <div className="relative">
                    <p className="text-sm font-semibold tracking-widest text-beam uppercase">Demo booking</p>
                    <h1 className="mt-3 font-display text-4xl font-bold tracking-tight">See BeamCraft on your use case</h1>
                    <p className="mt-3 text-muted-foreground">A 30-minute working session with a solutions engineer — tailored to the workflow you describe below.</p>
                    <div className="mt-9">
                        <LeadForm type="demo" />
                    </div>
                </div>
            </main>
            <SiteFooter />
        </div>
    );
}
