"use client";

import { useCallback, useEffect, useState } from "react";
import Button from "@/components/shared/Button";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import useSubmitOnce from "@/components/shared/useSubmitOnce";
import { downloadMyOfferLetter, getMyOfferLetter } from "@/services/hrm/myOfferLetter.service";

/*
 * My Profile → My Details → Offer Letter: one card, in the style of the details cards beside it - the
 * signed-in employee's own offer letter, where it stands, and a Download once it is ready. It comes the
 * days after their date of joining that Settings names; before then, or with nothing to count from, the
 * card says so.
 */

const dayFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const longDay = (iso) => (iso ? dayFormat.format(new Date(`${iso}T00:00:00Z`)) : "");

// What each state says to the employee - in their words, with what happens next.
const STATUS_TEXT = {
  READY: () => "Your offer letter is ready to download.",
  PENDING: (letter) => `Your offer letter will be ready on ${longDay(letter.availableOn)}.`,
  NOT_SET: () => "Your offer letter is not ready yet. HR will make it available here.",
  NO_JOINING_DATE: () => "Your offer letter is not ready yet - your date of joining is not on your record. Ask HR to add it.",
};

export default function MyOfferLetter() {
  const [letter, setLetter] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const { busy, run } = useSubmitOnce();
  const { notice, showError, clearNotice } = useNotice();

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      setLetter((await getMyOfferLetter())?.data || null);
    } catch (error) {
      setLoadError(error?.data?.message || error?.message || "Unable to load your offer letter.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  function download() {
    void run(async () => {
      try {
        await downloadMyOfferLetter({ fileName: letter?.fileName });
      } catch (error) {
        showError(error?.message || "Unable to download your offer letter.");
      }
    });
  }

  const ready = letter?.status === "READY";
  const text = loading ? "Loading..." : loadError || (STATUS_TEXT[letter?.status] || STATUS_TEXT.NOT_SET)(letter || {});

  // Half a row beside References: the title, where it stands and the Download, one under the other.
  return <section className="flex h-full flex-col items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
    <div className="min-w-0">
      <h3 className="text-sm font-semibold text-slate-800">Offer Letter</h3>
      <p role={loadError ? "alert" : undefined} className={`mt-1 text-sm ${loadError ? "text-red-600" : "text-slate-600"}`}>{text}</p>
    </div>
    {ready && <Button type="button" variant="primary" size="sm" busy={busy} busyLabel="Preparing PDF..." onClick={download}>Download</Button>}
    {loadError && <Button type="button" variant="secondary" size="sm" onClick={load}>Try again</Button>}
    <FloatingNotice notice={notice} onClose={clearNotice} />
  </section>;
}
