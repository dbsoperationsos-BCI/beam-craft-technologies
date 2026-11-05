import React from 'react';
import { Helmet } from 'react-helmet';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Check, Cpu, Workflow, Gauge, Coins, ShieldCheck, Handshake, Phone, Mail, MapPin } from 'lucide-react';
import SiteHeader from '@/components/marketing/SiteHeader';
import SiteFooter from '@/components/marketing/SiteFooter';
import Reveal from '@/components/Reveal';
import CountUp from '@/components/CountUp';
import { useSiteContent } from '@/lib/content';

const FEATURE_ICONS = [Cpu, Workflow, Gauge, Coins, ShieldCheck, Handshake];
const MARQUEE_WORDS = ['Forecasting', 'Anomaly Detection', 'Workflow Automation', 'Executive Dashboards', 'Usage Analytics', 'Decision Intelligence', 'Realtime Operations', 'Custom AI Models'];
const MOCK_BARS = [34, 52, 44, 68, 58, 82, 74, 96];

function HeroMockup() {
    return (
        <motion.div
            initial={{ opacity: 0, y: 40, rotateX: 12 }}
            animate={{ opacity: 1, y: 0, rotateX: 0 }}
            transition={{ duration: 0.9, delay: 0.35, ease: [0.22, 1, 0.36, 1] }}
            style={{ transformPerspective: 1200 }}
            className="relative mx-auto mt-16 max-w-4xl"
        >
            <div className="absolute -inset-8 beam-glow" aria-hidden="true" />
            <div className="animate-float-slow relative overflow-hidden rounded-2xl border border-border bg-card card-elev">
                <div className="tech-scan" aria-hidden="true" />
                <div className="flex items-center gap-2 border-b border-border px-5 py-3">
                    <span className="h-2.5 w-2.5 rounded-full bg-destructive/70" />
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: 'hsl(var(--gold) / 0.7)' }} />
                    <span className="h-2.5 w-2.5 rounded-full bg-primary/70" />
                    <span className="ml-3 text-xs text-muted-foreground">beamcraft.app — Operations Overview</span>
                </div>
                <div className="grid gap-4 p-5 sm:grid-cols-3">
                    {[
                        { label: 'Operations this month', value: '28,412', delta: '+18.2%' },
                        { label: 'Active automations', value: '1,204', delta: '+9.6%' },
                        { label: 'Cost per operation', value: '$0.0038', delta: '-12.4%' },
                    ].map((s) => (
                        <div key={s.label} className="rounded-xl border border-border bg-background/60 p-4">
                            <p className="text-xs text-muted-foreground">{s.label}</p>
                            <p className="mt-1 font-display text-xl font-semibold">{s.value}</p>
                            <p className="mt-0.5 text-xs text-beam">{s.delta} vs last month</p>
                        </div>
                    ))}
                </div>
                <div className="px-5 pb-6">
                    <div className="rounded-xl border border-border bg-background/60 p-4">
                        <div className="mb-3 flex items-center justify-between">
                            <p className="text-xs font-medium text-muted-foreground">Usage trend — live</p>
                            <span className="flex items-center gap-1.5 text-xs text-beam"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" /> Streaming</span>
                        </div>
                        <div className="flex h-28 items-end gap-2">
                            {MOCK_BARS.map((h, i) => (
                                <motion.div
                                    key={i}
                                    initial={{ height: 0 }}
                                    animate={{ height: `${h}%` }}
                                    transition={{ duration: 0.7, delay: 0.7 + i * 0.08, ease: 'easeOut' }}
                                    className="flex-1 rounded-t-md bg-gradient-to-t from-primary/30 to-primary"
                                />
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </motion.div>
    );
}

export default function HomePage() {
    const content = useSiteContent();
    const { hero, stats, features, steps, pricing, testimonials } = content;

    return (
        <div className="min-h-screen bg-background text-foreground">
            <Helmet>
                <title>BeamCraft — Crafting Intelligence into Software</title>
                <meta name="description" content="BeamCraft builds customized next-gen applications for CEOs and Operations Directors. Usage-based pricing, free trial, and enterprise demos." />
            </Helmet>
            <SiteHeader />

            {/* Hero */}
            <section className="relative overflow-hidden pt-32 pb-20 md:pt-40">
                <div className="hero-grid absolute inset-0" aria-hidden="true" />
                <div className="beam-glow absolute inset-0" aria-hidden="true" />
                {/* Futuristic data nodes */}
                <div className="pointer-events-none absolute inset-0" aria-hidden="true">
                    <span className="tech-node absolute left-[12%] top-[28%] h-2 w-2 rounded-full bg-primary" />
                    <span className="tech-node absolute right-[14%] top-[22%] h-2 w-2 rounded-full bg-primary" style={{ animationDelay: '0.6s' }} />
                    <span className="tech-node absolute left-[20%] bottom-[18%] h-1.5 w-1.5 rounded-full bg-gold" style={{ animationDelay: '1.1s' }} />
                    <span className="tech-node absolute right-[22%] bottom-[24%] h-1.5 w-1.5 rounded-full bg-primary" style={{ animationDelay: '1.6s' }} />
                </div>
                <div className="relative mx-auto max-w-6xl px-5 text-center">
                    <Reveal>
                        <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-xs font-medium tracking-wide text-beam">
                            <span className="h-1.5 w-1.5 rounded-full bg-primary" /> {hero.eyebrow}
                        </span>
                    </Reveal>
                    <Reveal delay={0.1}>
                        <h1 className="mx-auto mt-6 max-w-4xl font-display text-5xl font-bold leading-[1.05] tracking-tight md:text-7xl">
                            Crafting <span className="beam-underline text-beam">Intelligence</span> into Software
                        </h1>
                    </Reveal>
                    <Reveal delay={0.2}>
                        <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground md:text-lg">{hero.subtitle}</p>
                    </Reveal>
                    <Reveal delay={0.3}>
                        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
                            <Link to="/signup" className="group flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary px-7 text-sm font-semibold text-primary-foreground transition-all hover:brightness-110 active:scale-[0.98] sm:w-auto">
                                {hero.primaryCta}
                                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                            </Link>
                            <Link to="/demo" className="flex h-12 w-full items-center justify-center rounded-lg border border-border bg-card/60 px-7 text-sm font-semibold transition-colors hover:border-primary/50 hover:text-beam active:scale-[0.98] sm:w-auto">
                                {hero.secondaryCta}
                            </Link>
                        </div>
                    </Reveal>
                    <HeroMockup />
                </div>
            </section>

            {/* Marquee */}
            <section className="border-y border-border bg-card/40 py-4 overflow-hidden">
                <div className="animate-marquee flex w-max gap-10 whitespace-nowrap">
                    {[...MARQUEE_WORDS, ...MARQUEE_WORDS].map((w, i) => (
                        <span key={i} className="flex items-center gap-10 text-sm font-medium tracking-wide text-muted-foreground">
                            {w} <span className="h-1 w-1 rounded-full bg-primary/60" />
                        </span>
                    ))}
                </div>
            </section>

            {/* Stats */}
            <section className="mx-auto max-w-6xl px-5 py-20">
                <div className="grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
                    {stats.map((s, i) => (
                        <div key={i} className="bg-card p-8">
                            <p className="font-display text-4xl font-bold text-beam">
                                <CountUp value={s.value} suffix={s.suffix || ''} decimals={s.decimals || 0} />
                            </p>
                            <p className="mt-2 text-sm text-muted-foreground">{s.label}</p>
                        </div>
                    ))}
                </div>
            </section>

            {/* Features — sticky split */}
            <section id="features" className="mx-auto max-w-6xl px-5 py-20">
                <div className="grid gap-12 lg:grid-cols-[1fr_1.4fr]">
                    <div className="lg:sticky lg:top-28 lg:self-start">
                        <Reveal>
                            <p className="text-sm font-semibold tracking-widest text-beam uppercase">Why BeamCraft</p>
                            <h2 className="mt-3 font-display text-3xl font-bold tracking-tight md:text-4xl">
                                Software shaped around your operation — not the other way round
                            </h2>
                            <p className="mt-4 leading-relaxed text-muted-foreground">
                                Off-the-shelf SaaS forces your teams into someone else's workflow. BeamCraft crafts each application around yours, with intelligence at the core.
                            </p>
                            <Link to="/demo" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-beam hover:underline">
                                See it in a live demo <ArrowRight className="h-4 w-4" />
                            </Link>
                        </Reveal>
                    </div>
                    <div className="space-y-4">
                        {features.map((f, i) => {
                            const Icon = FEATURE_ICONS[i % FEATURE_ICONS.length];
                            return (
                                <Reveal key={i} delay={i * 0.06}>
                                    <div className="group flex gap-5 rounded-2xl border border-border bg-card p-6 transition-colors hover:border-primary/40">
                                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-beam transition-colors group-hover:bg-primary/20">
                                            <Icon className="h-5 w-5" strokeWidth={1.8} />
                                        </span>
                                        <div>
                                            <h3 className="font-display text-lg font-semibold">{f.title}</h3>
                                            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{f.description}</p>
                                        </div>
                                    </div>
                                </Reveal>
                            );
                        })}
                    </div>
                </div>
            </section>

            {/* How it works */}
            <section id="how" className="border-y border-border bg-card/40 py-20">
                <div className="mx-auto max-w-6xl px-5">
                    <Reveal>
                        <p className="text-sm font-semibold tracking-widest text-beam uppercase">How it works</p>
                        <h2 className="mt-3 max-w-xl font-display text-3xl font-bold tracking-tight md:text-4xl">From brief to working software in weeks</h2>
                    </Reveal>
                    <div className="mt-12 grid gap-8 md:grid-cols-3">
                        {steps.map((s, i) => (
                            <Reveal key={i} delay={i * 0.12}>
                                <div className="relative border-t-2 border-primary/40 pt-6">
                                    <span className="font-display text-5xl font-bold text-primary/25">0{i + 1}</span>
                                    <h3 className="mt-3 font-display text-xl font-semibold">{s.title}</h3>
                                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.description}</p>
                                </div>
                            </Reveal>
                        ))}
                    </div>
                </div>
            </section>

            {/* Pricing */}
            <section id="pricing" className="mx-auto max-w-6xl px-5 py-20">
                <Reveal>
                    <div className="text-center">
                        <p className="text-sm font-semibold tracking-widest text-beam uppercase">Pricing</p>
                        <h2 className="mx-auto mt-3 max-w-2xl font-display text-3xl font-bold tracking-tight md:text-4xl">Usage-based. Radically simple.</h2>
                        <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
                            Start free, pay only for the operations you run, and move to a custom enterprise agreement when scale demands it.
                        </p>
                    </div>
                </Reveal>
                <div className="mt-12 grid gap-6 lg:grid-cols-3">
                    {pricing.map((tier, i) => (
                        <Reveal key={i} delay={i * 0.1}>
                            <div className={`flex h-full flex-col rounded-2xl border p-7 ${tier.highlighted ? 'border-primary/60 bg-card shadow-[0_0_60px_-20px_hsl(var(--primary)/0.35)]' : 'border-border bg-card/60'}`}>
                                {tier.highlighted && <span className="mb-4 w-fit rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold text-beam">Most popular</span>}
                                <h3 className="font-display text-xl font-semibold">{tier.name}</h3>
                                <p className="mt-3 font-display text-3xl font-bold">{tier.price}</p>
                                <p className="mt-1 text-xs text-muted-foreground">{tier.period}</p>
                                <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{tier.description}</p>
                                <ul className="mt-6 flex-1 space-y-2.5">
                                    {(tier.features || []).map((f, j) => (
                                        <li key={j} className="flex items-start gap-2.5 text-sm">
                                            <Check className="mt-0.5 h-4 w-4 shrink-0 text-beam" strokeWidth={2.5} /> {f}
                                        </li>
                                    ))}
                                </ul>
                                <Link
                                    to={tier.name === 'Enterprise' ? '/quote' : '/signup'}
                                    className={`mt-7 flex h-11 items-center justify-center rounded-lg text-sm font-semibold transition-all active:scale-[0.98] ${tier.highlighted ? 'bg-primary text-primary-foreground hover:brightness-110' : 'border border-border hover:border-primary/50 hover:text-beam'}`}
                                >
                                    {tier.cta}
                                </Link>
                            </div>
                        </Reveal>
                    ))}
                </div>
            </section>

            {/* Testimonials */}
            <section id="testimonials" className="border-y border-border bg-card/40 py-20">
                <div className="mx-auto max-w-6xl px-5">
                    <Reveal>
                        <p className="text-sm font-semibold tracking-widest text-beam uppercase">Customers</p>
                        <h2 className="mt-3 font-display text-3xl font-bold tracking-tight md:text-4xl">Trusted by operators who measure everything</h2>
                    </Reveal>
                    <div className="mt-12 grid gap-6 md:grid-cols-3">
                        {testimonials.map((t, i) => (
                            <Reveal key={i} delay={i * 0.1}>
                                <figure className="flex h-full flex-col rounded-2xl border border-border bg-background/60 p-7">
                                    <blockquote className="flex-1 text-sm leading-relaxed text-foreground/90">“{t.quote}”</blockquote>
                                    <figcaption className="mt-6 border-t border-border pt-4">
                                        <p className="text-sm font-semibold">{t.name}</p>
                                        <p className="text-xs text-muted-foreground">{t.role}, {t.company}</p>
                                    </figcaption>
                                </figure>
                            </Reveal>
                        ))}
                    </div>
                </div>
            </section>

            {/* Final CTA */}
            <section className="relative overflow-hidden py-24">
                <div className="beam-glow absolute inset-0" aria-hidden="true" />
                <Reveal>
                    <div className="relative mx-auto max-w-3xl px-5 text-center">
                        <h2 className="font-display text-3xl font-bold tracking-tight md:text-5xl">Ready to craft your next advantage?</h2>
                        <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
                            Start a free trial today, or book a demo and get a tailored quote for your operation.
                        </p>
                        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                            <Link to="/signup" className="flex h-12 w-full items-center justify-center rounded-lg bg-primary px-8 text-sm font-semibold text-primary-foreground transition-all hover:brightness-110 active:scale-[0.98] sm:w-auto">
                                Start Free Trial
                            </Link>
                            <Link to="/quote" className="flex h-12 w-full items-center justify-center rounded-lg border border-border bg-card/60 px-8 text-sm font-semibold transition-colors hover:border-primary/50 hover:text-beam active:scale-[0.98] sm:w-auto">
                                Request Demo / Quote
                            </Link>
                        </div>
                    </div>
                </Reveal>
            </section>

            {/* Contact */}
            <section id="contact" className="border-t border-border bg-secondary/40 py-20">
                <div className="mx-auto max-w-6xl px-5">
                    <Reveal>
                        <div className="text-center">
                            <p className="text-sm font-semibold tracking-widest text-beam uppercase">Get in touch</p>
                            <h2 className="mx-auto mt-3 max-w-2xl font-display text-3xl font-bold tracking-tight md:text-4xl">Talk to our team</h2>
                            <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
                                Book a demo, request a quote, or ask anything — we usually reply within one business day.
                            </p>
                        </div>
                    </Reveal>
                    <div className="mt-12 grid gap-6 md:grid-cols-3">
                        <Reveal>
                            <a href="tel:+918149549549" className="group flex h-full flex-col items-center gap-3 rounded-2xl border border-border bg-card p-7 text-center card-elev transition-colors hover:border-primary/40">
                                <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-beam"><Phone className="h-5 w-5" strokeWidth={1.8} /></span>
                                <h3 className="font-display text-lg font-semibold">Phone</h3>
                                <p className="text-sm text-muted-foreground">+91 8149549549</p>
                            </a>
                        </Reveal>
                        <Reveal delay={0.1}>
                            <a href="mailto:hello@beamcraft.tech" className="group flex h-full flex-col items-center gap-3 rounded-2xl border border-border bg-card p-7 text-center card-elev transition-colors hover:border-primary/40">
                                <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-beam"><Mail className="h-5 w-5" strokeWidth={1.8} /></span>
                                <h3 className="font-display text-lg font-semibold">Email</h3>
                                <p className="text-sm text-muted-foreground">hello@beamcraft.tech</p>
                            </a>
                        </Reveal>
                        <Reveal delay={0.2}>
                            <div className="flex h-full flex-col items-center gap-3 rounded-2xl border border-border bg-card p-7 text-center card-elev">
                                <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-beam"><MapPin className="h-5 w-5" strokeWidth={1.8} /></span>
                                <h3 className="font-display text-lg font-semibold">Office</h3>
                                <p className="text-sm leading-relaxed text-muted-foreground">Beam Craft India Pvt. Ltd.<br />Thendral Nagar, Manikkampalayam,<br />Erode-638004, Tamilnadu</p>
                            </div>
                        </Reveal>
                    </div>
                </div>
            </section>

            <SiteFooter />
        </div>
    );
}
