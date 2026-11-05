"use client";

import Button from "@/components/shared/Button";
import Dialog from "@/components/ui/Dialog";
import { isLinkActive, linkExpiryText, versionLabel } from "./quotationLinkStatus";

/*
 * Every version of one quotation, and the state of each version's link.
 *
 * The register lists a quotation by its current version, because six versions of one negotiation as
 * six rows would bury every other enquiry. This is where those six are opened: what each was priced
 * at, whether the link sent for it still opens, and the one button that reopens a lapsed one.
 *
 * The versions of *this* quotation, not of its enquiry: an enquiry can hold several quotations - a
 * Dum Dum package and a Corp one - and each keeps its own history.
 *
 * **It is also where a quotation raised once is opened**, and that is not a special case - it is the
 * same card, drawn once. Download, Copy link and Edit live under each version and nowhere else, so a
 * chain of one had no way to reach its own link until this was offered for it too. Only the wording
 * changes: a single version is that quotation's link rather than a history of anything.
 *
 * Three actions, and they are the three things somebody opens this to do: save the document, send
 * the client its link, or price it again. **Open** was a fourth and went with them — it opened the
 * same public page the link points at, which is what Copy link hands over and what Download saves,
 * so it was a third way to reach one document. **Duplicate** went too: copying a package onto
 * another enquiry is starting a new quotation rather than anything about the version being read,
 * and it lives on the register row's own menu where the rest of that kind of work is.
 *
 * Cards rather than a table. At 360px a five-column table of ids, money, dates and three actions can
 * only scroll sideways, and the row a person came here for is the one that would be off-screen.
 */

const currency = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const raisedOn = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" });

export default function QuotationVersionsDialog({ quotation, canWrite, renewingId, onRenew, onCopyLink, onDownloadPdf, onEditVersion, onClose }) {
  const versions = quotation?.versions?.length ? quotation.versions : [quotation];
  // One version is a quotation, not a history of one. The cards below are identical either way.
  const single = versions.length === 1;

  return <Dialog
    title={`${(single ? versions[0]?.quotationId : quotation?.quotationNumber) || "Quotation"}${single ? "" : " — version history"}`}
    description={single
      ? `Raised for enquiry ${quotation?.enquiryId || "—"}. This is the link it was sent with.`
      : `${versions.length} versions of this quotation, raised for enquiry ${quotation?.enquiryId || "—"}. Each version keeps the link it was sent with.`}
    size="lg"
    /* A steady card for a list that grows as versions are raised; one version is a card with one
       thing in it, and a fixed 30rem around it would be mostly empty. */
    height={single ? "auto" : "mid"}
    onClose={onClose}
    footer={<Button type="button" variant="primary" onClick={onClose}>Done</Button>}
  >
    <ul className="space-y-3 pb-2">
      {versions.map((version) => {
        const live = isLinkActive(version);
        return <li key={version.id} className="rounded-lg border border-slate-200 bg-white px-3 py-3 sm:px-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <div className="min-w-0">
              {/* The id is the dialog's own heading when there is one version, so the card does not
                  repeat it back two lines lower. */}
              {!single && <p className="truncate text-sm font-semibold text-slate-800">{version.quotationId}</p>}
              <p className="mt-0.5 text-xs text-slate-500">{versionLabel(version)} · raised {raisedOn.format(new Date(version.createdAt))}</p>
            </div>
            <p className="text-sm font-semibold tabular-nums text-slate-800">{currency.format(Number(version.amount || 0))}</p>
          </div>
          {/* The status is said in words as well as in colour: a red dot alone is not a state
              anyone can read out to a client over the phone. */}
          <p className={`mt-2 text-xs ${live ? "text-emerald-700" : "text-red-700"}`}>{linkExpiryText(version)}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {/* Both are the public link — one saved, one handed over — so both go when it lapses.
                Copying an address that answers "expired" is worse than not offering it. */}
            {live && <>
              <Button type="button" size="sm" variant="secondary" onClick={() => onDownloadPdf?.(version)}>Download</Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => onCopyLink?.(version)}>Copy link</Button>
            </>}
            {/* Offered on every version, live or lapsed, because it is not about the link at all:
                the generator opens on what this version was priced at, and saving raises the next
                version of the quotation. A write, so absent without READ_WRITE. */}
            {canWrite && <Button type="button" size="sm" variant="secondary" onClick={() => onEditVersion?.(version)}>Edit</Button>}
            {/* Re-enabling changes what a client outside the studio can open, so it is a write.
                Without READ_WRITE the button is absent rather than present and refused. */}
            {!live && canWrite && <Button
              type="button"
              size="sm"
              variant="primary"
              disabled={renewingId === version.id}
              onClick={() => onRenew?.(version)}
            >
              {renewingId === version.id ? "Re-enabling…" : "Re-enable for 5 days"}
            </Button>}
            {!live && !canWrite && <p className="text-xs text-slate-500">Ask someone with quotation access to re-enable this link.</p>}
          </div>
        </li>;
      })}
    </ul>
  </Dialog>;
}
