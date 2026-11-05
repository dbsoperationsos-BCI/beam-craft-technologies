"use client";

/**
 * The frame around a page somebody reaches by a link rather than by signing in: the onboarding
 * application, the interview screening form, the CRD document, the offboarding form.
 *
 * Those pages sit outside `AppShell` - there is no sidebar, no top bar and no session - so each one
 * drew its own centred card on its own grey background, and by the fourth they had drifted: the same
 * two helpers, copied, with a different `max-w` and nothing holding the tones together. They are a
 * house style rather than any one form's layout, so they live here.
 *
 * `PublicLayout` is the page: full viewport height, a grey ground, and a centred column whose width
 * the form chooses (a long application wants `5xl`, a form asking one question wants `3xl`).
 *
 * `PublicNotice` is what a public page says when there is no form to show - a dead link, or the
 * thank-you after one is sent. `tone` carries whether that is a failure: `red` for one,
 * `green` for a finished task, and the default `slate` for an ordinary statement, which is what a
 * form already sent in deserves rather than a red box for somebody who did everything right.
 */

const WIDTHS = {
  "3xl": "max-w-3xl",
  "5xl": "max-w-5xl",
};

export function PublicLayout({ children, width = "5xl" }) {
  return <main className="min-h-[100dvh] bg-slate-100 px-4 py-8 sm:px-6 sm:py-12">
    <div className={`mx-auto w-full ${WIDTHS[width] || WIDTHS["5xl"]}`}>{children}</div>
  </main>;
}

export function PublicNotice({ title, children, tone = "slate" }) {
  const styles = tone === "red"
    ? "border-red-200 bg-red-50 text-red-800"
    : tone === "green"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : "border-slate-200 bg-white text-slate-700";
  return <section className={`rounded-xl border p-6 shadow-sm ${styles}`}>
    <h1 className="text-xl font-semibold">{title}</h1>
    <div className="mt-2 text-sm leading-6">{children}</div>
  </section>;
}

export default PublicLayout;
