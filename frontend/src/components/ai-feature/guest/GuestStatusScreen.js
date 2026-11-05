import Loader from "@/components/shared/Loader";
import AppLogo from "@/components/shared/AppLogo";
import ExpiredClientLink from "@/components/shared/ExpiredClientLink";
import { expiredLinkFrom } from "@/lib/expiredLink.mjs";

/**
 * The page while nothing else can be shown: the wait before the event is known, or the polite
 * dead end when the link is wrong or the service is unreachable. An expired link is the shared
 * expired page instead.
 */
export default function GuestStatusScreen({ loading = false, status, message, failure = null, onRetry, subject = "event", loadingLabel = "Opening the event..." }) {
  // A lapsed link is the shared expired page every client link uses.
  const expiredLink = !loading && expiredLinkFrom(failure || { status });
  if (expiredLink) return <ExpiredClientLink {...expiredLink} />;
  const missing = Number(status) === 404;
  // `subject` names what the link opens - an event, or a Photo Selling gallery - in the copy below.
  const title = loading ? "" : missing ? `We couldn't find that ${subject}` : "Something went wrong";
  const detail = loading ? "" : missing ? "Check the link you were sent - it may have been typed wrong, or the host may have closed it." : message || "Please try again in a moment.";
  return <main className="flex min-h-dvh flex-col items-center justify-center bg-[#f4f7fb] px-4 py-12">
    <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 text-center shadow-[0_20px_52px_rgba(15,23,42,0.08)] sm:p-9">
      <div className="flex justify-center"><AppLogo variant="onboarding" /></div>
      {loading
        ? <Loader label={loadingLabel} size="lg" className="pt-6" />
        : <>
          <h1 className="mt-6 text-xl font-semibold text-slate-900">{title}</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">{detail}</p>
          {onRetry && !missing && <button type="button" onClick={onRetry} className="mt-6 inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 hover:bg-slate-50">Try again</button>}
        </>}
    </div>
  </main>;
}
