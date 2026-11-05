import { Inter, Space_Grotesk } from "next/font/google";
import AccountTreeRoundedIcon from "@mui/icons-material/AccountTreeRounded";
import ArrowForwardRoundedIcon from "@mui/icons-material/ArrowForwardRounded";
import CheckRoundedIcon from "@mui/icons-material/CheckRounded";
import HandshakeRoundedIcon from "@mui/icons-material/HandshakeRounded";
import MailOutlineRoundedIcon from "@mui/icons-material/MailOutlineRounded";
import MemoryRoundedIcon from "@mui/icons-material/MemoryRounded";
import PhoneRoundedIcon from "@mui/icons-material/PhoneRounded";
import PlaceRoundedIcon from "@mui/icons-material/PlaceRounded";
import SavingsRoundedIcon from "@mui/icons-material/SavingsRounded";
import SpeedRoundedIcon from "@mui/icons-material/SpeedRounded";
import VerifiedUserRoundedIcon from "@mui/icons-material/VerifiedUserRounded";
import CountUp from "./CountUp";
import MarketingFooter from "./MarketingFooter";
import MarketingHeader from "./MarketingHeader";
import Reveal from "./Reveal";
import { CONTACT, CONTACT_HREF, FEATURES, HERO, MARQUEE_WORDS, PRICING, STATS, STEPS, TESTIMONIALS } from "./homeContent";
import styles from "./marketing.module.css";

// Self-hosted at build time by `next/font`, and loaded only on this page.
const inter = Inter({ subsets: ["latin"], variable: "--mk-font-sans", display: "swap" });
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--mk-font-display", display: "swap" });

const FEATURE_ICONS = [MemoryRoundedIcon, AccountTreeRoundedIcon, SpeedRoundedIcon, SavingsRoundedIcon, VerifiedUserRoundedIcon, HandshakeRoundedIcon];
const MOCK_STATS = [
  { label: "Operations this month", value: "28,412", delta: "+18.2%" },
  { label: "Active automations", value: "1,204", delta: "+9.6%" },
  { label: "Cost per operation", value: "$0.0038", delta: "-12.4%" },
];
const MOCK_BARS = [34, 52, 44, 68, 58, 82, 74, 96];

const eyebrow = "text-sm font-semibold uppercase tracking-widest text-mk-primary";
const sectionTitle = "font-mk-display text-3xl font-bold tracking-tight md:text-4xl";
const primaryButton = "flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-mk-primary px-7 text-sm font-semibold text-mk-primary-foreground transition-all hover:brightness-110 active:scale-[0.98] sm:w-auto";
const secondaryButton = "flex h-12 w-full items-center justify-center rounded-lg border border-mk-border bg-mk-card/60 px-7 text-sm font-semibold transition-colors hover:border-mk-primary/50 hover:text-mk-primary active:scale-[0.98] sm:w-auto";

/** The illustrative dashboard under the hero - a picture of the product, not live figures. */
function HeroMockup() {
  return (
    <div className={`relative mx-auto mt-16 max-w-4xl ${styles.mockupRise}`} aria-hidden="true">
      <div className={`absolute -inset-8 ${styles.beamGlow}`} />
      <div className={`relative overflow-hidden rounded-2xl border border-mk-border bg-mk-card text-left ${styles.cardElev} ${styles.floatSlow}`}>
        <div className={styles.techScan} />
        <div className="flex items-center gap-2 border-b border-mk-border px-5 py-3">
          <span className="h-2.5 w-2.5 rounded-full bg-mk-destructive/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-mk-gold/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-mk-primary/70" />
          <span className="ml-3 truncate text-xs text-mk-muted-foreground">beamcraft.app — Operations Overview</span>
        </div>
        <div className="grid gap-4 p-5 sm:grid-cols-3">
          {MOCK_STATS.map((stat) => (
            <div key={stat.label} className="rounded-xl border border-mk-border bg-mk-background/60 p-4">
              <p className="text-xs text-mk-muted-foreground">{stat.label}</p>
              <p className="mt-1 font-mk-display text-xl font-semibold">{stat.value}</p>
              <p className="mt-0.5 text-xs text-mk-primary">{stat.delta} vs last month</p>
            </div>
          ))}
        </div>
        <div className="px-5 pb-6">
          <div className="rounded-xl border border-mk-border bg-mk-background/60 p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs font-medium text-mk-muted-foreground">Usage trend — live</p>
              <span className="flex items-center gap-1.5 text-xs text-mk-primary"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-mk-primary" /> Streaming</span>
            </div>
            <div className="flex h-28 items-end gap-2">
              {MOCK_BARS.map((height, index) => (
                <div key={index} className={`flex-1 rounded-t-md bg-gradient-to-t from-mk-primary/30 to-mk-primary ${styles.bar}`} style={{ height: `${height}%`, animationDelay: `${0.7 + index * 0.08}s` }} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The public home page at `/`, ported from the BeamCraft marketing site (`home-page/`).
 *
 * Everything on it is public and static. Its only way into the application is Sign in, which opens
 * `/login`; the trial, demo and quote buttons lead to the contact section, because this application
 * has no signup or enquiry forms of its own.
 */
export default function MarketingHomePage() {
  return (
    <div className={`${styles.root} ${inter.variable} ${spaceGrotesk.variable} min-h-screen flex-1`}>
      <MarketingHeader />

      <main>
        {/* Hero */}
        <section className="relative overflow-hidden pb-20 pt-32 md:pt-40">
          <div className={`absolute inset-0 ${styles.heroGrid}`} aria-hidden="true" />
          <div className={`absolute inset-0 ${styles.beamGlow}`} aria-hidden="true" />
          <div className="pointer-events-none absolute inset-0" aria-hidden="true">
            <span className={`absolute left-[12%] top-[28%] h-2 w-2 rounded-full bg-mk-primary ${styles.techNode}`} />
            <span className={`absolute right-[14%] top-[22%] h-2 w-2 rounded-full bg-mk-primary ${styles.techNode}`} style={{ animationDelay: "0.6s" }} />
            <span className={`absolute bottom-[18%] left-[20%] h-1.5 w-1.5 rounded-full bg-mk-gold ${styles.techNode}`} style={{ animationDelay: "1.1s" }} />
            <span className={`absolute bottom-[24%] right-[22%] h-1.5 w-1.5 rounded-full bg-mk-primary ${styles.techNode}`} style={{ animationDelay: "1.6s" }} />
          </div>
          <div className="relative mx-auto max-w-6xl px-4 text-center sm:px-5">
            <Reveal>
              <span className="inline-flex items-center gap-2 rounded-full border border-mk-primary/30 bg-mk-primary/10 px-4 py-1.5 text-xs font-medium tracking-wide text-mk-primary">
                <span className="h-1.5 w-1.5 rounded-full bg-mk-primary" /> {HERO.eyebrow}
              </span>
            </Reveal>
            <Reveal delay={0.1}>
              <h1 className="mx-auto mt-6 max-w-4xl font-mk-display text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl md:text-7xl">
                Crafting <span className={`${styles.beamUnderline} text-mk-primary`}>Intelligence</span> into Software
              </h1>
            </Reveal>
            <Reveal delay={0.2}>
              <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-mk-muted-foreground md:text-lg">{HERO.subtitle}</p>
            </Reveal>
            <Reveal delay={0.3}>
              <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <a href={CONTACT_HREF} className={`group ${primaryButton}`}>
                  {HERO.primaryCta}
                  <ArrowForwardRoundedIcon sx={{ fontSize: 16 }} className="transition-transform group-hover:translate-x-0.5" />
                </a>
                <a href={CONTACT_HREF} className={secondaryButton}>{HERO.secondaryCta}</a>
              </div>
            </Reveal>
            <HeroMockup />
          </div>
        </section>

        {/* Marquee */}
        <section className="overflow-hidden border-y border-mk-border bg-mk-card/40 py-4" aria-hidden="true">
          <div className={`flex w-max gap-10 whitespace-nowrap ${styles.marquee}`}>
            {[...MARQUEE_WORDS, ...MARQUEE_WORDS].map((word, index) => (
              <span key={index} className="flex items-center gap-10 text-sm font-medium tracking-wide text-mk-muted-foreground">
                {word} <span className="h-1 w-1 rounded-full bg-mk-primary/60" />
              </span>
            ))}
          </div>
        </section>

        {/* Stats */}
        <section className="mx-auto max-w-6xl px-4 py-20 sm:px-5">
          <div className="grid gap-px overflow-hidden rounded-2xl border border-mk-border bg-mk-border sm:grid-cols-2 lg:grid-cols-4">
            {STATS.map((stat) => (
              <div key={stat.label} className="bg-mk-card p-8">
                <p className="font-mk-display text-4xl font-bold text-mk-primary"><CountUp value={stat.value} suffix={stat.suffix} decimals={stat.decimals || 0} /></p>
                <p className="mt-2 text-sm text-mk-muted-foreground">{stat.label}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Features */}
        <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-5">
          <div className="grid gap-12 lg:grid-cols-[1fr_1.4fr]">
            <div className="lg:sticky lg:top-28 lg:self-start">
              <Reveal>
                <p className={eyebrow}>Why BeamCraft</p>
                <h2 className={`mt-3 ${sectionTitle}`}>Software shaped around your operation — not the other way round</h2>
                <p className="mt-4 leading-relaxed text-mk-muted-foreground">Off-the-shelf SaaS forces your teams into someone else&apos;s workflow. BeamCraft crafts each application around yours, with intelligence at the core.</p>
                <a href={CONTACT_HREF} className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-mk-primary hover:underline">
                  See it in a live demo <ArrowForwardRoundedIcon sx={{ fontSize: 16 }} />
                </a>
              </Reveal>
            </div>
            <div className="space-y-4">
              {FEATURES.map((feature, index) => {
                const Icon = FEATURE_ICONS[index % FEATURE_ICONS.length];
                return (
                  <Reveal key={feature.title} delay={index * 0.06}>
                    <div className="group flex gap-5 rounded-2xl border border-mk-border bg-mk-card p-6 transition-colors hover:border-mk-primary/40">
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-mk-primary/10 text-mk-primary transition-colors group-hover:bg-mk-primary/20">
                        <Icon sx={{ fontSize: 20 }} />
                      </span>
                      <div className="min-w-0">
                        <h3 className="font-mk-display text-lg font-semibold">{feature.title}</h3>
                        <p className="mt-1.5 text-sm leading-relaxed text-mk-muted-foreground">{feature.description}</p>
                      </div>
                    </div>
                  </Reveal>
                );
              })}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="scroll-mt-16 border-y border-mk-border bg-mk-card/40 py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-5">
            <Reveal>
              <p className={eyebrow}>How it works</p>
              <h2 className={`mt-3 max-w-xl ${sectionTitle}`}>From brief to working software in weeks</h2>
            </Reveal>
            <div className="mt-12 grid gap-8 md:grid-cols-3">
              {STEPS.map((step, index) => (
                <Reveal key={step.title} delay={index * 0.12}>
                  <div className="relative border-t-2 border-mk-primary/40 pt-6">
                    <span className="font-mk-display text-5xl font-bold text-mk-primary/25">0{index + 1}</span>
                    <h3 className="mt-3 font-mk-display text-xl font-semibold">{step.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-mk-muted-foreground">{step.description}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="mx-auto max-w-6xl scroll-mt-16 px-4 py-20 sm:px-5">
          <Reveal className="text-center">
            <p className={eyebrow}>Pricing</p>
            <h2 className={`mx-auto mt-3 max-w-2xl ${sectionTitle}`}>Usage-based. Radically simple.</h2>
            <p className="mx-auto mt-4 max-w-xl text-mk-muted-foreground">Start free, pay only for the operations you run, and move to a custom enterprise agreement when scale demands it.</p>
          </Reveal>
          <div className="mt-12 grid gap-6 lg:grid-cols-3">
            {PRICING.map((tier, index) => (
              <Reveal key={tier.name} delay={index * 0.1} className="h-full">
                <div className={`flex h-full flex-col rounded-2xl border p-7 ${tier.highlighted ? `border-mk-primary/60 bg-mk-card ${styles.highlightedTier}` : "border-mk-border bg-mk-card/60"}`}>
                  {tier.highlighted && <span className="mb-4 w-fit rounded-full bg-mk-primary/15 px-3 py-1 text-xs font-semibold text-mk-primary">Most popular</span>}
                  <h3 className="font-mk-display text-xl font-semibold">{tier.name}</h3>
                  <p className="mt-3 font-mk-display text-3xl font-bold">{tier.price}</p>
                  <p className="mt-1 text-xs text-mk-muted-foreground">{tier.period}</p>
                  <p className="mt-4 text-sm leading-relaxed text-mk-muted-foreground">{tier.description}</p>
                  <ul className="mt-6 flex-1 space-y-2.5">
                    {tier.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-2.5 text-sm">
                        <CheckRoundedIcon sx={{ fontSize: 16, mt: "2px", flexShrink: 0, color: "hsl(var(--mk-primary))" }} /> {feature}
                      </li>
                    ))}
                  </ul>
                  <a href={CONTACT_HREF} className={`mt-7 flex h-11 items-center justify-center rounded-lg text-sm font-semibold transition-all active:scale-[0.98] ${tier.highlighted ? "bg-mk-primary text-mk-primary-foreground hover:brightness-110" : "border border-mk-border hover:border-mk-primary/50 hover:text-mk-primary"}`}>{tier.cta}</a>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* Testimonials */}
        <section id="testimonials" className="scroll-mt-16 border-y border-mk-border bg-mk-card/40 py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-5">
            <Reveal>
              <p className={eyebrow}>Customers</p>
              <h2 className={`mt-3 ${sectionTitle}`}>Trusted by operators who measure everything</h2>
            </Reveal>
            <div className="mt-12 grid gap-6 md:grid-cols-3">
              {TESTIMONIALS.map((testimonial, index) => (
                <Reveal key={testimonial.name} delay={index * 0.1} className="h-full">
                  <figure className="flex h-full flex-col rounded-2xl border border-mk-border bg-mk-background/60 p-7">
                    <blockquote className="flex-1 text-sm leading-relaxed text-mk-foreground/90">“{testimonial.quote}”</blockquote>
                    <figcaption className="mt-6 border-t border-mk-border pt-4">
                      <p className="text-sm font-semibold">{testimonial.name}</p>
                      <p className="text-xs text-mk-muted-foreground">{testimonial.role}, {testimonial.company}</p>
                    </figcaption>
                  </figure>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* Final call to action */}
        <section className="relative overflow-hidden py-24">
          <div className={`absolute inset-0 ${styles.beamGlow}`} aria-hidden="true" />
          <Reveal className="relative mx-auto max-w-3xl px-4 text-center sm:px-5">
            <h2 className="font-mk-display text-3xl font-bold tracking-tight md:text-5xl">Ready to craft your next advantage?</h2>
            <p className="mx-auto mt-4 max-w-xl text-mk-muted-foreground">Start a free trial today, or book a demo and get a tailored quote for your operation.</p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <a href={CONTACT_HREF} className={primaryButton}>{HERO.primaryCta}</a>
              <a href={CONTACT_HREF} className={secondaryButton}>{HERO.secondaryCta}</a>
            </div>
          </Reveal>
        </section>

        {/* Contact */}
        <section id="contact" className="scroll-mt-16 border-t border-mk-border bg-mk-secondary/40 py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-5">
            <Reveal className="text-center">
              <p className={eyebrow}>Get in touch</p>
              <h2 className={`mx-auto mt-3 max-w-2xl ${sectionTitle}`}>Talk to our team</h2>
              <p className="mx-auto mt-4 max-w-xl text-mk-muted-foreground">Book a demo, request a quote, or ask anything — we usually reply within one business day.</p>
            </Reveal>
            <div className="mt-12 grid gap-6 md:grid-cols-3">
              <Reveal className="h-full">
                <a href={CONTACT.phoneHref} className={`flex h-full flex-col items-center gap-3 rounded-2xl border border-mk-border bg-mk-card p-7 text-center transition-colors hover:border-mk-primary/40 ${styles.cardElev}`}>
                  <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-mk-primary/10 text-mk-primary"><PhoneRoundedIcon sx={{ fontSize: 20 }} /></span>
                  <h3 className="font-mk-display text-lg font-semibold">Phone</h3>
                  <p className="text-sm text-mk-muted-foreground">{CONTACT.phone}</p>
                </a>
              </Reveal>
              <Reveal delay={0.1} className="h-full">
                <a href={`mailto:${CONTACT.email}`} className={`flex h-full flex-col items-center gap-3 rounded-2xl border border-mk-border bg-mk-card p-7 text-center transition-colors hover:border-mk-primary/40 ${styles.cardElev}`}>
                  <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-mk-primary/10 text-mk-primary"><MailOutlineRoundedIcon sx={{ fontSize: 20 }} /></span>
                  <h3 className="font-mk-display text-lg font-semibold">Email</h3>
                  <p className="break-all text-sm text-mk-muted-foreground">{CONTACT.email}</p>
                </a>
              </Reveal>
              <Reveal delay={0.2} className="h-full">
                <div className={`flex h-full flex-col items-center gap-3 rounded-2xl border border-mk-border bg-mk-card p-7 text-center ${styles.cardElev}`}>
                  <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-mk-primary/10 text-mk-primary"><PlaceRoundedIcon sx={{ fontSize: 20 }} /></span>
                  <h3 className="font-mk-display text-lg font-semibold">Office</h3>
                  <p className="text-sm leading-relaxed text-mk-muted-foreground">Beam Craft India Pvt. Ltd.<br />Thendral Nagar, Manikkampalayam,<br />Erode-638004, Tamilnadu</p>
                </div>
              </Reveal>
            </div>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}
