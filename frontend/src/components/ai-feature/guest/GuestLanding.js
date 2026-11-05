"use client";
import { veilClassesFor } from "@/lib/heroContrast.mjs";
import GuestHero from "./GuestHero";
import GuestJoinCard from "./GuestJoinCard";

/**
 * The page before a session exists, as one composition: the event's cover fills the page behind
 * everything, and over it sit the studio's mark, the event's identity, the join card on a pane of
 * glass, and the schedule. Nothing here is a section of its own with a colour of its own - there
 * is no white bar for the mark, no white block for the details, no grey block for the form.
 *
 * The cover is an absolute layer of the page rather than a fixed one, so it stays behind the form
 * however far a small phone has to scroll. Over it is a veil, lighter at the top where the mark
 * and the name sit and deep at the foot behind the card, whose strength follows how bright the
 * cover is where the text sits - measured by the server and sent as `event.coverVeil` - so a bright
 * photograph is dimmed more and a dark one less while the words stay white on both. Behind the
 * event's words there is a soft scrim as well, so a light patch of sky or dress under the name
 * cannot take it. With no cover the page is a quiet dark neutral and the same layout holds.
 *
 * `GuestJoinCard` is the same form with the same questions, checks and submit; only its surface
 * changed. The join itself is `onJoin`, as before.
 *
 * `joinCopy` (the card's words) and `children` (said under the card) let the Photo Selling store use
 * this same page as its login; the AI Feature passes neither.
 */
export default function GuestLanding({ meta, onJoin, joinCopy, children }) {
  const event = meta?.event;
  return <main data-hero-veil={event?.coverVeil || "medium"} className="relative isolate min-h-dvh overflow-x-hidden bg-[#141821] text-white">
    {/* The cover, edge to edge and behind everything. Centred a little above the middle on a
        phone, where a landscape photograph's faces usually are once it is cropped to a tall
        screen; centred on a desktop. No focal point is stored for a cover, so this is a guess made
        the same way for every event rather than one tuned to one photograph. */}
    <div aria-hidden="true" className="absolute inset-0 -z-10">
      {event?.coverUrl
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={event.coverUrl} alt="" fetchPriority="high" decoding="async" className="h-full w-full object-cover object-[center_35%] md:object-center" />
        : <div className="h-full w-full bg-linear-to-b from-[#232a38] to-[#0f1216]" />}
      <div className={`absolute inset-0 transition-colors duration-500 motion-reduce:transition-none ${veilClassesFor(event?.coverVeil)}`} />
    </div>

    <div className="mx-auto flex w-full max-w-5xl flex-col items-center px-4 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))] sm:px-6 md:pt-10">
      {/* The scrim: a soft dark pool behind the words alone, wider than they are and feathered at
          its edge, so it reads as shade on the photograph rather than a box on it. */}
      <div className="relative w-full">
        <div aria-hidden="true" className="absolute inset-x-[-10%] inset-y-[-12%] -z-10 rounded-[50%] bg-black/30 blur-3xl" />
        <GuestHero event={event} />
      </div>
      <div className="mt-7 w-full max-w-135 md:mt-9"><GuestJoinCard meta={meta} onJoin={onJoin} copy={joinCopy} />{children}</div>
    </div>
  </main>;
}
