"use client";

import { useRouter } from "next/navigation";
import DescriptionOutlined from "@mui/icons-material/DescriptionOutlined";
import Button from "@/components/shared/Button";
import { CLIENT_SERIF } from "@/components/shared/ProjectTracker";
import { PROGRESS_COLORS } from "@/lib/progressStatus.mjs";
import { dayLabel } from "@/lib/projectTracking.mjs";

/*
 * What each state of the CRD document says to the client, in their words rather than the studio's:
 * "Sent" is, to them, something waiting on them - so it says so, and asks.
 */
const CRD_STATES = {
  notStarted: {
    chip: "Not started",
    color: PROGRESS_COLORS.notStarted,
    text: "The studio will share this form with you when it is time to plan your event.",
  },
  awaiting: {
    chip: "Waiting for your details",
    color: PROGRESS_COLORS.inProgress,
    text: "Tell us about your event - the people, the places and the moments that matter - so we can plan your shoot around them.",
  },
  inProgress: {
    chip: "Started - not yet submitted",
    color: PROGRESS_COLORS.partiallyCompleted,
    text: "You have started your form. Finish it and press Submit so the studio receives your details.",
  },
  submitted: {
    chip: "Form submitted",
    color: PROGRESS_COLORS.completed,
    text: "Thank you - the studio has your details.",
  },
};

// The public CRD form's route (`app/crd/[token]`) with the 16-character token the server issues.
const CRD_FILL_PATH = /^\/crd\/[A-Za-z0-9_-]{16}$/;

/**
 * The client portal's CRD document: where the form stands and, while it is theirs to fill, the way
 * into it - Complete opens the same form the studio's WhatsApp link does. Absent for a project
 * that needs no CRD document (`crd` is null). The server decides the state and gives the link only
 * while it is the client's to use.
 *
 * Drawn as the page's closing invitation rather than one more white card: a deep earth card with a
 * gold light at its corner, titled by the form's own name. On that ground the state is a light pill with its colour as a dot, since a
 * status chip's tint is made for white.
 */
export default function ClientCrdCard({ crd }) {
  const router = useRouter();
  const state = CRD_STATES[crd?.state];
  if (!state) return null;
  const submittedOn = crd.state === "submitted" && crd.submittedOn ? ` Submitted on ${dayLabel(crd.submittedOn)}.` : "";
  // Only ever the CRD form's own path: a server string is not followed anywhere else.
  const fillPath = CRD_FILL_PATH.test(String(crd.fillPath || "")) ? crd.fillPath : null;

  return <section aria-labelledby="client-crd-title" className="client-fade relative overflow-hidden rounded-2xl bg-[linear-gradient(150deg,var(--client-earth)_0%,var(--client-film)_100%)] p-6 text-white shadow-[0_22px_44px_-26px_rgba(46,36,25,0.9)] [animation-delay:400ms] sm:p-8">
    <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-[var(--client-primary)] opacity-30 blur-3xl" />
    <div className="relative flex items-center gap-4">
      <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[var(--client-primary)] text-[var(--client-ink)]"><DescriptionOutlined /></span>
      <div className="min-w-0">
        <h2 id="client-crd-title" className={`${CLIENT_SERIF} text-[2rem] font-semibold leading-none`}>CRD Document</h2>
      </div>
    </div>
    <p className="relative mt-5 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold">
      <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: state.color }} />{state.chip}
    </p>
    <p className="relative mt-4 max-w-xl text-[15px] leading-relaxed text-white/90">{state.text}{submittedOn}</p>
    {/* The client pages' gold, as on their sign-in - with ink, not white, on it. */}
    {fillPath && <Button type="button" variant="plain" className="relative mt-6 !min-h-12 w-full !rounded-xl bg-[var(--client-primary)] !text-base !font-bold text-[var(--client-ink)] hover:bg-[var(--client-primary-hover)] sm:w-auto sm:px-10" onClick={() => router.push(fillPath)}>Complete</Button>}
  </section>;
}
