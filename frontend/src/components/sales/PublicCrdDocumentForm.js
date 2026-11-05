"use client";

import { useEffect, useState } from "react";
import Loader from "@/components/shared/Loader";
import { getPublicCrdDocument } from "@/services/sales/public-crd-document.service";
import { Notice, PublicLayout, TITLE_PREFIX_BY_VERTICAL } from "./crdDocumentShared";
import PublicCrdDocumentFormDumDum from "./PublicCrdDocumentFormDumDum";
import PublicCrdDocumentFormQuaQua from "./PublicCrdDocumentFormQuaQua";

/**
 * The Customer Identification Document, as the client fills it in from the link Sales sends.
 *
 * Fetches once by token — that single response is what tells this shell which vertical the link
 * belongs to — then hands it down to that vertical's own body. Dum Dum and Qua Qua ask for
 * different things and store a differently-shaped document, so past this point they are separate
 * components; only the fetch, the loading/error states and the tab title are shared.
 */
export default function PublicCrdDocumentForm({ token }) {
  const [context, setContext] = useState(null);
  // Starts true and is only ever turned off, so the first render needs no setState from the effect
  // body — which would cascade a second render before anything had loaded.
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  /*
   * Nothing about filling the document in lives here.
   *
   * Saving, submitting, the "what was last written" ref and the notice this shell used to own went
   * down into the two vertical bodies when the form was split, and each holds its own — seeded from
   * `initialContext`, which this shell has and they are handed. Copies left behind up here would be
   * a second set of the same flags, permanently at their defaults and read by nobody.
   */

  useEffect(() => {
    let active = true;
    getPublicCrdDocument(token)
      .then((response) => {
        if (!active) return;
        setContext(response?.data || null);
      })
      .catch((error) => { if (active) setLoadError(error.message || "Unable to load this CRD document."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token]);

  // The tab title otherwise reads "CRD Document" for every link, which is indistinguishable when a
  // studio user has both a Dum Dum and a Qua Qua link open at once.
  useEffect(() => {
    if (!context?.vertical) return;
    const prefix = TITLE_PREFIX_BY_VERTICAL[context.vertical] || context.vertical;
    window.document.title = `${prefix}-CRD Document | DBS`;
  }, [context?.vertical]);

  if (loading) return <PublicLayout><Notice title="Customer Identification Document"><Loader label="Opening your document…" inline /></Notice></PublicLayout>;
  if (loadError) return <PublicLayout><Notice title="This document link is unavailable" tone="red">{loadError}</Notice></PublicLayout>;

  if (context?.vertical === "QQ") return <PublicCrdDocumentFormQuaQua token={token} initialContext={context} />;
  return <PublicCrdDocumentFormDumDum token={token} initialContext={context} />;
}
