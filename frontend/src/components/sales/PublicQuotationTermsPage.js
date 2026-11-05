"use client";

import { useEffect, useMemo, useState } from "react";
import ExpiredClientLink from "@/components/shared/ExpiredClientLink";
import DeviceViewport from "@/components/shared/DeviceViewport";
import { expiredLinkFrom } from "@/lib/expiredLink.mjs";
import AppLogo, { DocumentLogo } from "@/components/shared/AppLogo";
import useStudioBranding from "@/components/shared/useStudioBranding";
import { getPublicQuotation } from "@/services/sales/public-quotation.service";
import { GOLD, GOLD_DEEP, INK, QUOTATION_BODY_FONT, RuledTitle, SHEET_CSS, sheetBackground } from "./PublicQuotationPage";
import { templateContentFor } from "./quotationTemplateContent";

/*
 * The Terms & Conditions of one quotation, at `/q/<token>/terms`.
 *
 * The quotation itself prints the link rather than the clauses - that is how the studio's design
 * reads, and a page of small print between the closing lines and the infrastructure was the one
 * thing on the sheet nobody was meant to stop and read. Following the link opens this: the same
 * sheet, the same ground, the same mark and name, and the clauses set to be read.
 *
 * They are the version's own, from its snapshot, exactly as the quotation prints everything else -
 * so a client opening a quotation from months ago reads the terms it was sent with, whatever the
 * studio has changed since.
 */
export default function PublicQuotationTermsPage({ token }) {
  const [quotation, setQuotation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expired, setExpired] = useState(null);
  const branding = useStudioBranding();

  useEffect(() => {
    let active = true;
    getPublicQuotation(token)
      .then((response) => { if (active) { setQuotation(response.data); setError(""); setExpired(null); } })
      .catch((requestError) => { if (active) { setExpired(expiredLinkFrom(requestError)); setError(requestError.message || "Unable to load quotation."); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token]);

  const content = useMemo(() => templateContentFor(quotation, branding), [quotation, branding]);

  // The same three states the quotation settles in, said the same way.
  if (loading) return <main className="grid min-h-dvh place-items-center bg-white p-6 text-slate-500">Loading terms…</main>;
  if (expired) return <ExpiredClientLink {...expired} data-quotation-state="expired" />;
  // Laid out for the phone itself, as the expired card is: in the sheet's 1112px viewport it was
  // drawn at a third of its size. An error is not gone back from, so the viewport stays switched.
  if (error) return <DeviceViewport><main data-quotation-state="error" className="grid min-h-dvh place-items-center bg-white p-6 text-center">
    <div className="w-full max-w-md">
      <AppLogo variant="print" />
      <h1 className="mt-8 text-2xl font-normal" style={{ fontFamily: "Georgia, 'Times New Roman', serif", color: INK }}>Unable to load these terms</h1>
      <p className="mt-3 text-sm leading-relaxed text-slate-600">{error}</p>
    </div>
  </main></DeviceViewport>;

  return <main
    data-quotation-state="ready"
    className="min-h-dvh bg-[#e9e6df] px-0 py-0 sm:px-4 sm:py-8"
    style={{ fontFamily: QUOTATION_BODY_FONT, color: INK }}
  >
    <style>{SHEET_CSS}</style>

    <article className="q-sheet relative mx-auto w-full max-w-[1080px] overflow-hidden shadow-sm" style={{ background: sheetBackground }}>
      <div className="relative px-6 pb-16 pt-14 sm:px-16">
        <header className="text-center">
          <DocumentLogo variant="quotation" src={content.logoUrl} priority className="mx-auto" />
          {Boolean(content.brandName) && <p className="q-display mt-4 text-[20px] font-semibold uppercase tracking-[0.3em] sm:text-[26px]" style={{ color: INK }}>{content.brandName}</p>}
          <RuledTitle className="mt-8" size="text-[30px] sm:text-[38px]">{content.termsTitle}</RuledTitle>
          {Boolean(quotation.quotationId) && <p className="q-label mt-3 text-[10px] font-semibold" style={{ color: GOLD_DEEP }}>{quotation.quotationId}</p>}
        </header>

        {content.terms.length
          ? <ol className="mx-auto mt-12 max-w-3xl space-y-7">
            {content.terms.map((term, index) => <li key={`${index}-${term.title}`} className="grid grid-cols-[2.25rem_1fr] gap-x-3">
              <span className="text-[13px] font-semibold" style={{ color: GOLD }}>{String(index + 1).padStart(2, "0")}</span>
              <div>
                <p className="text-[15px] font-semibold" style={{ color: INK }}>{term.title}</p>
                <p className="mt-1.5 text-[13.5px] leading-relaxed" style={{ color: "#5c5c5c" }}>{term.body}</p>
              </div>
            </li>)}
          </ol>
          : <p className="mx-auto mt-12 max-w-3xl text-center text-[14px]" style={{ color: "#5c5c5c" }}>No terms are attached to this quotation.</p>}

        <p className="mt-14 text-center">
          <a href={`/q/${encodeURIComponent(token)}`} className="text-[13px] font-semibold underline underline-offset-4" style={{ color: "#1a5cd6" }}>Back to the quotation</a>
        </p>
      </div>
    </article>
  </main>;
}
