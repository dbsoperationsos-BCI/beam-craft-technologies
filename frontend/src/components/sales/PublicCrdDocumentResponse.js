"use client";

import { useEffect, useState } from "react";
import Loader from "@/components/shared/Loader";
import { DocumentLogo } from "@/components/shared/AppLogo";
import { getPublicCrdResponse } from "@/services/sales/public-crd-document.service";
import CrdDocumentResponse from "./CrdDocumentResponse";
import { Notice, PublicLayout } from "./crdDocumentShared";

/**
 * A submitted CRD document, opened by whoever was given its share link.
 *
 * The link this page answers is not the one the client filled the document through: that token
 * still opens the form, so it is not what gets forwarded. This one reads the response and can do
 * nothing else — there is no form here to save or submit.
 */
export default function PublicCrdDocumentResponse({ token }) {
  const [response, setResponse] = useState(null);
  // Starts true and is only ever turned off, so the first render needs no setState from the effect
  // body — which would cascade a second render before anything had loaded.
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let active = true;
    getPublicCrdResponse(token)
      .then((data) => { if (active) setResponse(data?.data || null); })
      .catch((error) => { if (active) setLoadError(error.message || "Unable to load this response."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token]);

  if (loading) return <PublicLayout><Notice title="Customer Identification Document"><Loader label="Opening this response…" inline /></Notice></PublicLayout>;
  if (loadError) return <PublicLayout><Notice title="This response link is unavailable" tone="red">{loadError}</Notice></PublicLayout>;

  const submitted = response?.submittedAt ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(response.submittedAt)) : "";

  return <PublicLayout>
    <header className="sticky top-0 z-50 shrink-0 border-b border-slate-200 bg-white shadow-sm">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 px-4 pb-[10px] pt-3 sm:px-6 lg:pl-0">
        <div className="flex min-w-0 items-center gap-4">
          <div className="relative hidden h-11 w-64 shrink-0 lg:block">
            {/* The logo this document was issued under, from its own record rather than today's
                Settings - the same mark the client saw when the link reached them. */}
            <DocumentLogo variant="crd" src={response?.logoUrl} priority className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" />
          </div>
          <DocumentLogo variant="document" src={response?.logoUrl} priority className="shrink-0 lg:hidden" />
          <div className="min-w-0">
            <h1 className="text-base font-semibold text-slate-900 sm:text-xl">Customer Identification Document</h1>
            <p className="mt-0.5 truncate text-xs text-slate-600 sm:text-sm">
              {[response?.eventId, response?.clientName].filter(Boolean).join(" · ") || "Submitted response"}
            </p>
          </div>
        </div>
      </div>
    </header>

    <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-white">
      <div className="w-full max-w-[1040px]">
        <div className="border-b border-slate-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 sm:px-6">
          This is the client&apos;s submitted response{submitted ? `, received ${submitted}` : ""}. It is read-only.
        </div>
        <CrdDocumentResponse response={response} />
      </div>
    </main>
  </PublicLayout>;
}
