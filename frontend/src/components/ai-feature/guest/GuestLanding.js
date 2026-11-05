"use client";
import GuestHero from "./GuestHero";
import GuestSchedule from "./GuestSchedule";
import GuestJoinCard from "./GuestJoinCard";

/** The page before a session exists: the cover and the details, the schedule, and the join card. */
export default function GuestLanding({ meta, onJoin }) {
  return <main className="min-h-dvh bg-[#f4f7fb] pb-12">
    <GuestHero event={meta?.event} />
    <div className="space-y-8 pt-6 sm:pt-8">
      <GuestSchedule schedule={meta?.schedule} />
      <div className="mx-auto w-full max-w-[504px] px-4"><GuestJoinCard meta={meta} onJoin={onJoin} /></div>
    </div>
  </main>;
}
