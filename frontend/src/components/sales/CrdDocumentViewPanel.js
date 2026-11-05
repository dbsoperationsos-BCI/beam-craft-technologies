"use client";

import { useCallback, useEffect, useState } from "react";
import Button from "@/components/shared/Button";
import Loader from "@/components/shared/Loader";
import Dialog from "@/components/ui/Dialog";
import { createCrdResponseLink, getCrdDocumentResponse } from "@/services/sales/crd-documents.service";
import { publicOrigin } from "@/lib/publicOrigin";
import CrdDocumentResponse from "./CrdDocumentResponse";

/**
 * ⋮ → View on a CRD Documents row: what the client actually sent back.
 *
 * A row that has not been submitted has no response to show, and says so rather than drawing an
 * empty document — the studio is waiting on the client, which is a different thing from the client
 * having answered nothing.
 *
 * The share link is issued from here rather than being created with the document, because most
 * responses are never shared and a link that exists is a link that can leak. Pressing it twice
 * returns the same URL, so a link already sent is never invalidated.
 *
 * `readOnly` is the Overall Status's View: the answers alone - no share link, no button to make one.
 * `loadResponse` reads the response another way (the project's own route there), and `layer` stacks
 * the dialog over the panel it was opened from.
 */
export default function CrdDocumentViewPanel({ row, onClose, readOnly = false, loadResponse, layer }) {
  const documentId = row?.crdDocument?.id || "";
  const submitted = Boolean(row?.crdDocument?.submittedAt);

  const [response, setResponse] = useState(null);
  const [loading, setLoading] = useState(submitted);
  const [error, setError] = useState("");
  const [shareUrl, setShareUrl] = useState(!readOnly && row?.crdDocument?.sharePath ? `${publicOrigin()}${row.crdDocument.sharePath}` : "");
  const [sharing, setSharing] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!submitted || !documentId) return;
    setLoading(true);
    try {
      setResponse((await (loadResponse ? loadResponse() : getCrdDocumentResponse(documentId)))?.data || null);
      setError("");
    } catch (failure) {
      setError(failure.message || "Unable to load this response.");
    } finally {
      setLoading(false);
    }
  }, [documentId, submitted, loadResponse]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function share() {
    setSharing(true);
    setError("");
    try {
      const created = (await createCrdResponseLink(documentId))?.data;
      setShareUrl(`${publicOrigin()}${created?.sharePath || ""}`);
    } catch (failure) {
      setError(failure.message || "Unable to create the response link.");
    } finally {
      setSharing(false);
    }
  }

  async function copyShareUrl() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
    } catch {
      setError("Unable to copy. Select the link manually.");
    }
  }

  return <Dialog
    title={row?.eventId || row?.clientName || "CRD Document"}
    description={submitted ? "What the client submitted." : "This document has not been submitted yet."}
    size="lg"
    height="tall"
    onClose={onClose}
    layer={layer}
    footer={<>
      <Button type="button" onClick={onClose}>Close</Button>
      {!readOnly && submitted && !shareUrl && <Button type="button" variant="primary" disabled={sharing} onClick={() => void share()}>
        {sharing ? "Creating..." : "Share Response"}
      </Button>}
      {!readOnly && submitted && shareUrl && <Button type="button" variant="primary" onClick={() => void copyShareUrl()}>{copied ? "Copied" : "Copy Response Link"}</Button>}
    </>}
  >
    <div className="pb-2">
      {error && <p className="mb-3 text-sm text-rose-600">{error}</p>}

      {shareUrl && <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
        <p className="text-xs font-semibold text-slate-600">Response link</p>
        <a href={shareUrl} target="_blank" rel="noreferrer" className="mt-1 block break-all text-sm font-medium text-blue-700 underline">{shareUrl}</a>
        <p className="mt-2 text-xs text-slate-500">Read-only, and safe to forward: it opens the answers and not the form the client filled them through.</p>
      </div>}

      {!submitted && <p className="text-sm text-slate-600">
        The client has not submitted this document yet. Their answers appear here once they do.
      </p>}

      {submitted && loading && <Loader label="Loading the response…" inline />}
      {submitted && !loading && !error && <div className="-mx-4 sm:-mx-6"><CrdDocumentResponse response={response} /></div>}
    </div>
  </Dialog>;
}
