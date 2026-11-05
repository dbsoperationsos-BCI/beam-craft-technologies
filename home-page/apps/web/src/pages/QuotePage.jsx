import React from 'react';
import { Helmet } from 'react-helmet';
import SiteHeader from '@/components/marketing/SiteHeader';
import SiteFooter from '@/components/marketing/SiteFooter';
import LeadForm from '@/components/LeadForm';

export default function QuotePage() {
    return (
        <div className="min-h-screen bg-background text-foreground">
            <Helmet>
                <title>Request a Quote — BeamCraft</title>
                <meta name="description" content="Request a tailored BeamCraft quote for your custom application or enterprise engagement." />
            </Helmet>
            <SiteHeader />
            <main className="relative mx-auto max-w-2xl px-5 pt-32 pb-24">
                <div className="beam-glow absolute inset-0" aria-hidden="true" />
                <div className="relative">
                    <p className="text-sm font-semibold tracking-widest text-beam uppercase">Quote request</p>
                    <h1 className="mt-3 font-display text-4xl font-bold tracking-tight">Get a tailored quote</h1>
                    <p className="mt-3 text-muted-foreground">Tell us about your project and we'll respond with pricing shaped to your usage profile within two business days.</p>
                    <div className="mt-9">
                        <LeadForm type="quote" />
                    </div>
                </div>
            </main>
            <SiteFooter />
        </div>
    );
}
