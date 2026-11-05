"use client";

import { useEffect, useRef, useState } from "react";
import CardGiftcardOutlined from "@mui/icons-material/CardGiftcardOutlined";
import CategoryOutlined from "@mui/icons-material/CategoryOutlined";
import ConfirmationNumberOutlined from "@mui/icons-material/ConfirmationNumberOutlined";
import EventOutlined from "@mui/icons-material/EventOutlined";
import FlagOutlined from "@mui/icons-material/FlagOutlined";
import PlaceOutlined from "@mui/icons-material/PlaceOutlined";
import FilmStrip from "@/components/client/FilmStrip";
import ShootTimeline from "@/components/client/ShootTimeline";
import Button from "@/components/shared/Button";
import DashboardCard, { CardState } from "@/components/shared/DashboardCard";
import ProgressChip from "@/components/shared/ProgressChip";
import { projectTrackingView } from "@/lib/projectTracking.mjs";

// The stage sheet: rounded and lifted off the page.
const CLIENT_CARD = "!rounded-2xl border-[color-mix(in_srgb,var(--client-sand)_55%,white)] shadow-[0_14px_36px_-22px_rgba(46,36,25,0.45)]";
// The page's voice - a stage's name, a section of it - in the serif the client pages carry.
export const CLIENT_SERIF = "font-[family-name:var(--client-serif)]";
// The icon that goes with each detail a stage can name.
const FACT_ICONS = { Status: FlagOutlined, "Event ID": ConfirmationNumberOutlined, Branch: PlaceOutlined, Vertical: CategoryOutlined, "Main event date": EventOutlined };
const SECTION = `${CLIENT_SERIF} text-[1.35rem] font-semibold leading-none text-[var(--client-ink)]`;

/**
 * A stage as a frame on the film: developed (done), being developed (current), or still blank - its
 * number, its name, and a tick or a dot. The stage whose sheet is showing wears a ring.
 *
 * A stage reached so far is a button that opens its sheet (`onPick`), so a finished stage can be
 * read again once it is over; a blank one has nothing to show yet and is no button. `copy` is a
 * frame of the strip that comes back on a scroll up: a tap there picks the stage too, but the copy
 * is for the eye and the finger only - a keyboard or a screen reader has the strip itself, so its
 * buttons are out of the tab order - and it does not develop again as it appears, which happened
 * once already.
 */
function StageFrame({ step, index, copy = false, onPick }) {
  const done = step.state === "done";
  const current = step.state === "current";
  const look = done
    ? "bg-[var(--client-sand)] text-[var(--client-ink)]"
    : current
      ? "frame-sheen bg-[var(--client-primary)] text-[var(--client-ink)]"
      : "border border-dashed border-[color-mix(in_srgb,var(--client-sand)_30%,transparent)] bg-white/[0.04] text-[color-mix(in_srgb,var(--client-sand)_75%,transparent)]";
  const ring = step.selected ? "ring-2 ring-[color-mix(in_srgb,var(--client-primary)_45%,white)] ring-offset-2 ring-offset-[var(--client-film)]" : "";
  const face = <>
    <span className="flex items-center justify-between">
      <span className="text-[11px] font-bold tabular-nums opacity-70">{index + 1}</span>
      {done && <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5 rounded-full bg-[var(--client-earth)] p-1 text-white" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4.5 10.5l3.5 3.5 7.5-8" /></svg>}
      {current && <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-[var(--client-ink)]" />}
    </span>
    <span className="min-w-0 text-left">
      <span className="block truncate text-[13px] font-bold leading-tight">{step.label}</span>
      <span className="sr-only">{done ? " (done)" : current ? " (current)" : " (not started)"}</span>
    </span>
  </>;
  const frame = "flex h-full w-full flex-col justify-between p-2";
  return <li
    aria-current={current ? "step" : undefined}
    data-current={current || undefined}
    data-selected={step.selected || undefined}
    style={copy ? undefined : { animationDelay: `${450 + index * 140}ms` }}
    className={`${copy ? "" : "frame-develop "}relative h-[4.25rem] w-[7.75rem] shrink-0 snap-center overflow-hidden rounded-md sm:w-auto sm:min-w-0 sm:flex-1 ${look} ${ring}`}
  >
    {done || current
      ? <Button type="button" variant="plain" size="none" tabIndex={copy ? -1 : undefined} aria-pressed={step.selected} aria-controls="client-stage-sheet" className={`${frame} !items-stretch !justify-between !rounded-md !text-inherit hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--client-ink)]`} onClick={() => onPick(step.key)}>{face}</Button>
      : <span className={frame}>{face}</span>}
  </li>;
}

/** Somebody looking after the stage, by name - or the place their name will go. */
function TeamMember({ role, name }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  return <li className="flex min-w-0 items-center gap-3">
    {name
      ? <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,var(--client-sand),color-mix(in_srgb,var(--client-primary)_55%,var(--client-sand)))] text-sm font-extrabold text-[var(--client-ink)] shadow-[inset_0_0_0_2px_white]">{initials}</span>
      : <span aria-hidden="true" className="h-11 w-11 shrink-0 rounded-full border-2 border-dashed border-[color-mix(in_srgb,var(--client-earth)_35%,white)]" />}
    <span className="min-w-0">
      <span className={`block truncate text-[15px] font-bold ${name ? "text-[var(--client-ink)]" : "text-slate-400"}`}>{name || "To be assigned"}</span>
      <span className="block truncate text-xs text-slate-500">{role}</span>
    </span>
  </li>;
}

/** How far the page has scrolled - the window's, or the body's where the body is the scroll box. */
function pageScrollTop() {
  return Math.max(window.scrollY || 0, document.body?.scrollTop || 0);
}

/**
 * Bring the frame whose sheet is showing to the middle of a strip - along it only, never the page up
 * or down, which `scrollIntoView` would also do for the copy fixed under the bar.
 */
function centreSelectedFrame(strip, behavior) {
  const frame = strip?.querySelector("[data-selected]");
  if (!frame || strip.scrollWidth <= strip.clientWidth) return;
  const frameBox = frame.getBoundingClientRect();
  const stripBox = strip.getBoundingClientRect();
  strip.scrollBy({ left: frameBox.left + frameBox.width / 2 - (stripBox.left + stripBox.width / 2), behavior });
}

/**
 * Where a project stands, for the client's portal: its five stages as frames on a strip of film -
 * the stages done developed, the one being worked on gold, the rest still blank - and that stage's
 * sheet: how far through its shoots it is, who is looking after it, its details, the
 * client gifts, and its shoots as cards - on Production, each with its timeline (`ShootTimeline`). The stages are the studio's own, worked out on the server
 * by the rule Edit Project → Status uses, so the client reads what the studio reads.
 *
 * As it opens, the strip winds in and its frames develop in order (globals.css, `film-*`,
 * `frame-*`) - one moment, still for anybody
 * whose device asks for less motion. On a phone the strip swipes, and keeps the stage being read in
 * its middle - the one being worked on as it opens, then whichever the client picks.
 *
 * Given `pinTop` (where the page's fixed bar ends), the strip also comes back once it has scrolled
 * away: scrolling up from further down the page slides a copy of it down under the bar, so
 * where the project stands is never more than a flick away; scrolling down tucks it away again, and
 * it leaves for good once the strip itself is back in sight. A stage tapped there opens its sheet
 * and brings it into view. The copy is for the eye and the finger (`aria-hidden`, out of the tab
 * order) - a keyboard and a screen reader have the strip itself - and it slides without moving for anybody
 * whose device asks for less motion.
 *
 * Every stage reached so far can be tapped on the strip to open its own sheet - a finished stage
 * stays readable once it is over - and the stage being worked on is the way back.
 *
 * `stageCards` puts a card of the caller's under one stage's sheet, shown only while that sheet is -
 * the client portal's CRD document under Pre Production.
 *
 * Read-only, and it fetches nothing: it draws the `tracking` it is handed (shape in
 * `lib/projectTracking.mjs`).
 */
export default function ProjectTracker({ tracking, className = "", pinTop = "", stageCards = {} }) {
  // The stage the client has picked on the strip; none means the one the project is at.
  const [chosenKey, setChosenKey] = useState("");
  const view = projectTrackingView(tracking, chosenKey);
  const { stage } = view;
  const stripRef = useRef(null);
  const pinnedRef = useRef(null);
  const pinnedStripRef = useRef(null);
  const [pinned, setPinned] = useState(false);
  // The strip the client's finger is on, which the other follows; and whether the strips have
  // been centred once (the opening is a jump, a stage picked after it a glide).
  const leaderRef = useRef(null);
  const centredRef = useRef(false);

  /*
   * On a phone, both strips - the page's and the copy under the bar - keep the stage being read in
   * their middle: the stage the project is at as the page opens, then whichever the client picks,
   * on either strip. A frame after the paint, once the strips have their widths. `auto` rather than
   * `instant`, which some phone browsers still refuse; a glide only after the opening, and never
   * for a device asking for less motion.
   */
  useEffect(() => {
    const raf = window.requestAnimationFrame(() => {
      const glide = centredRef.current && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      centredRef.current = true;
      leaderRef.current = null;
      for (const strip of [stripRef.current, pinnedStripRef.current]) centreSelectedFrame(strip, glide ? "smooth" : "auto");
    });
    return () => window.cancelAnimationFrame(raf);
  }, [stage.key]);

  /*
   * A swipe along one strip moves the other with it, so the copy that comes down shows the frames
   * the client left the page's strip on, and the page's strip is where the copy was when the client
   * scrolls back up to it. Only the strip being touched leads, so the two never pull on each other.
   */
  const lead = (event) => { leaderRef.current = event.currentTarget; };
  const follow = (event) => {
    const from = event.currentTarget;
    if (leaderRef.current !== from) return;
    const to = from === stripRef.current ? pinnedStripRef.current : stripRef.current;
    if (to && to.scrollLeft !== from.scrollLeft) to.scrollLeft = from.scrollLeft;
  };
  const swipe = { onPointerDown: lead, onTouchStart: lead, onWheel: lead, onScroll: follow };

  /*
   * The strip comes back on a scroll up. Once the strip has gone up under the bar, a scroll up of
   * more than a few pixels (not a finger's jitter, or a phone's bounce at the end of the page) brings
   * the copy down, and a scroll down sends it away; with the strip back in sight it is not needed.
   * Read at most once a frame.
   */
  useEffect(() => {
    if (!pinTop) return undefined;
    let last = pageScrollTop();
    let raf = 0;
    const update = () => {
      raf = 0;
      const strip = stripRef.current;
      const copy = pinnedRef.current;
      if (!strip || !copy) return;
      const now = pageScrollTop();
      const moved = now - last;
      if (Math.abs(moved) < 8) return;
      last = now;
      const barBottom = parseFloat(window.getComputedStyle(copy).top) || 0;
      if (strip.getBoundingClientRect().bottom > barBottom) setPinned(false);
      else setPinned(moved < 0);
    };
    const onScroll = () => { if (!raf) raf = window.requestAnimationFrame(update); };
    window.addEventListener("scroll", onScroll, { passive: true });
    document.body.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      document.body.removeEventListener("scroll", onScroll);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [pinTop]);

  /*
   * A stage picked on the copy that comes back on a scroll up: its sheet opens, and the page brings
   * the sheet's top to just under the copy - the client is further down, reading something else.
   * After the frame that draws the new sheet; a glide unless the device asks for less motion.
   */
  const pickFromCopy = (key) => {
    setChosenKey(key);
    window.requestAnimationFrame(() => {
      const sheet = document.getElementById("client-stage-sheet");
      const copyBottom = pinnedRef.current?.getBoundingClientRect().bottom || 0;
      if (!sheet) return;
      const top = pageScrollTop() + sheet.getBoundingClientRect().top - copyBottom - 12;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollTo({ top: Math.max(0, top), behavior: reduce ? "auto" : "smooth" });
    });
  };

  // The copy comes down showing the frames where the page's strip was left.
  useEffect(() => {
    if (pinned && stripRef.current && pinnedStripRef.current) pinnedStripRef.current.scrollLeft = stripRef.current.scrollLeft;
  }, [pinned]);

  return <div className={`min-w-0 space-y-7 ${className}`}>
    {/* The strip runs to the screen's edges on a phone, where it swipes. */}
    <div ref={stripRef} {...swipe} className="-mx-4 snap-x snap-mandatory overflow-x-auto px-4 pb-2 [scrollbar-width:none] sm:mx-0 sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden">
      <FilmStrip label="Project stages" winding className="w-max sm:w-full" listClassName="py-1.5">
        {view.steps.map((step, index) => <StageFrame key={step.key} step={step} index={index} onPick={setChosenKey} />)}
      </FilmStrip>
    </div>

    {pinTop && <div
      ref={pinnedRef}
      aria-hidden="true"
      data-pinned={pinned || undefined}
      style={{ top: pinTop }}
      className={`fixed inset-x-0 z-30 pt-2 transition-[transform,opacity,visibility] duration-300 ease-out motion-reduce:transition-none ${pinned ? "visible translate-y-0 opacity-100" : "pointer-events-none invisible -translate-y-full opacity-0"}`}
    >
      <div className="mx-auto w-full max-w-lg px-4 md:max-w-3xl">
        <div ref={pinnedStripRef} {...swipe} className="-mx-4 snap-x snap-mandatory overflow-x-auto px-4 pb-2 [scrollbar-width:none] sm:mx-0 sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden">
          <FilmStrip label="Project stages" className="w-max shadow-[0_16px_30px_-18px_rgba(46,36,25,0.7)] sm:w-full" listClassName="py-1.5">
            {view.steps.map((step, index) => <StageFrame key={step.key} step={step} index={index} copy onPick={pickFromCopy} />)}
          </FilmStrip>
        </div>
      </div>
    </div>}

    {/* Keyed by its stage, so a sheet picked on the strip fades in as the one now showing. */}
    <DashboardCard
      key={stage.key}
      id="client-stage-sheet"
      title={stage.label}
      note={stage.position}
      action={stage.state ? <ProgressChip variant="icon" color={stage.stateColor}>{stage.state}</ProgressChip> : null}
      className={`client-fade ${chosenKey ? "" : "[animation-delay:250ms]"} ${CLIENT_CARD}`}
      titleClassName={`${CLIENT_SERIF} !text-[2rem] !font-semibold !leading-tight !text-[var(--client-ink)]`}
      bodyClassName="space-y-8 p-5 sm:p-7"
    >
      {stage.progress && <p className="-mt-2 text-sm text-slate-500"><span className="font-bold text-[var(--client-earth)]">{stage.progress.label}</span> so far</p>}

      {stage.team.length > 0 && <section>
        <h3 className={SECTION}>Your team</h3>
        <ul className="mt-4 grid gap-4 sm:grid-cols-2">
          {stage.team.map((member) => <TeamMember key={member.role} role={member.role} name={member.name} />)}
        </ul>
      </section>}

      {stage.facts.length > 0 && <section>
        <h3 className={SECTION}>Details</h3>
        <dl className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2">
          {stage.facts.map((fact) => {
            const Icon = FACT_ICONS[fact.label] || FlagOutlined;
            return <div key={fact.label} className="flex min-w-0 items-center gap-3">
              <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--client-sand)_35%,white)] text-[var(--client-earth)]"><Icon className="!text-[20px]" /></span>
              <span className="min-w-0">
                <dt className="text-xs text-slate-500">{fact.label}</dt>
                <dd className="mt-0.5 break-words text-[15px] font-bold text-[var(--client-ink)]">{fact.chip ? <ProgressChip variant="icon" color={fact.color}>{fact.chip}</ProgressChip> : fact.value}</dd>
              </span>
            </div>;
          })}
        </dl>
      </section>}

      {stage.gifts.length > 0 && <section>
        <h3 className={SECTION}>Gifts from the studio</h3>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {stage.gifts.map((gift) => <li key={gift.label} className="flex items-center gap-3 rounded-xl bg-[linear-gradient(135deg,color-mix(in_srgb,var(--client-sand)_38%,white),white)] p-4 ring-1 ring-[color-mix(in_srgb,var(--client-sand)_60%,white)]">
            <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--client-primary)] text-[var(--client-ink)] shadow-[0_8px_18px_-10px_color-mix(in_srgb,var(--client-primary)_90%,transparent)]"><CardGiftcardOutlined className="!text-[22px]" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-bold text-[var(--client-ink)]">{gift.label}</span>
              <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                <ProgressChip variant="icon" color={gift.color}>{gift.chip}</ProgressChip>
                {gift.detail && <span className="text-xs text-slate-500">{gift.detail}</span>}
              </span>
            </span>
          </li>)}
        </ul>
      </section>}

      {stage.showShoots && <section>
        <h3 className={SECTION}>Your shoots</h3>
        <CardState empty={!stage.shoots.length} emptyMessage="No shoots added yet." rows={2}>
          {/* Each shoot a white card: its name, its date written under it as on the back of a photograph. */}
          <ul className="mt-4 grid gap-4 sm:grid-cols-2">
            {stage.shoots.map((shoot) => <li key={shoot.id} className="rounded-xl bg-white p-2.5 shadow-[0_10px_26px_-16px_rgba(46,36,25,0.5)] ring-1 ring-[color-mix(in_srgb,var(--client-sand)_55%,white)]">
              {/* The name and its day on the left, the chip on the right - under them on a card too narrow for both. */}
              <span className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 px-1.5 pb-1 pt-1">
                <span className="min-w-0">
                  <span className="block break-words text-[15px] font-bold text-[var(--client-ink)]">{shoot.name}</span>
                  {shoot.note && <span className={`${CLIENT_SERIF} block whitespace-nowrap text-base italic text-[var(--client-earth)]`}>{shoot.note}</span>}
                </span>
                {shoot.status && <span className="flex flex-col items-start gap-1">
                  <ProgressChip variant="icon" color={shoot.color}>{shoot.status}</ProgressChip>
                  {shoot.detail && <span className="pl-1.5 text-xs text-slate-500">{shoot.detail}</span>}
                </span>}
              </span>
              {shoot.timeline?.length > 0 && <div className="mx-1.5 mb-1 mt-3 border-t border-[color-mix(in_srgb,var(--client-sand)_45%,white)] pt-3">
                <ShootTimeline steps={shoot.timeline} label={`${shoot.name}: production progress`} />
              </div>}
            </li>)}
          </ul>
        </CardState>
      </section>}
    </DashboardCard>

    {stageCards[stage.key]}
  </div>;
}
