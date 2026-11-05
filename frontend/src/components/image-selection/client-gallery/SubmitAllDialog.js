"use client";

import Button from "@/components/shared/Button";
import Dialog from "@/components/ui/Dialog";
import { selectionProgressStatus } from "@/lib/selectionProgressStatus.mjs";
import SelectionStatusPill from "./SelectionStatusPill";

/**
 * Submit All's review: every selection item ready to send, under the shoot it belongs to, with its
 * count and its status - compact, no thumbnails; each item's own Review & Submit shows the photos.
 * Opening it sends nothing. Each ready item can
 * still go on its own through its usual Review & Submit, and the footer's Submit All sends the ready
 * ones together - all of them or, if the server refuses any, none, with the picks kept either way.
 *
 * `groups` comes from `submitAllGroups`. `sent` is what the server accepted - kept as it was sent, since the reloaded items now
 * all read as submitted - and swaps the body for the confirmation.
 */
export default function SubmitAllDialog({ heading, groups = [], onReviewItem, onSubmitAll, submitting = false, sent = null, onClose }) {
  const ready = groups.flatMap((group) => group.items.filter((entry) => entry.ready));

  if (sent) {
    return <Dialog
      title="Selections submitted"
      description={`Thank you - your studio has received ${sent.length === 1 ? "this selection" : "these selections"}.`}
      onClose={onClose}
      size="md"
      footer={<Button className="max-sm:flex-1" type="button" variant="primary" onClick={onClose}>Done</Button>}
    >
      <ul className="space-y-1 pb-1 text-sm text-slate-700">{sent.map(({ item, count }) => <li key={item.id}><strong>{item.name}</strong>{item.shoot?.shoot ? ` · ${item.shoot.shoot}` : ""} - {count} {count === 1 ? "photo" : "photos"}</li>)}</ul>
    </Dialog>;
  }

  return <Dialog
    title="Review All Selections"
    description={`${heading} · ${ready.length} ${ready.length === 1 ? "selection is" : "selections are"} ready to submit. Once submitted, a selection can no longer be changed.`}
    onClose={onClose}
    busy={submitting}
    size="lg"
    footerInline
    footer={<>
      <Button className="max-sm:flex-1" type="button" variant="primary" onClick={onSubmitAll} disabled={ready.length < 2} busy={submitting} busyLabel="Submitting...">Submit All</Button>
      <Button className="max-sm:flex-1" type="button" variant="secondary" onClick={onClose} disabled={submitting}>Close</Button>
    </>}
  >
    <div className="space-y-5 pb-1">
      {ready.length < 2 && <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 sm:text-sm">Only one selection is ready now, so Submit All is not needed - use its Review &amp; Submit below.</p>}
      {groups.map((group) => (
        <section key={group.key || "project"}>
          {group.label && <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{group.label}</h3>}
          <div className="space-y-3">
            {group.items.map(({ item, ready: itemReady, count }) => {
              const progress = selectionProgressStatus(count, item.selectionLimit || 0);
              return (
                <section key={item.id} className="flex flex-col gap-3 rounded-xl border border-slate-200 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="min-w-0 break-words text-sm font-semibold text-slate-900 sm:text-base">{item.name}</h4>
                      <SelectionStatusPill status={progress} submitted={!itemReady} />
                    </div>
                    <p className="mt-1 text-xs text-slate-600 sm:text-sm">
                      {itemReady ? <><strong>{count}</strong> of <strong>{item.selectionLimit}</strong> photos selected - included in Submit All</> : "Already sent to the studio - not included again."}
                    </p>
                  </div>
                  {itemReady && <Button type="button" size="sm" variant="secondary" className="shrink-0 max-sm:min-h-10 max-sm:w-full" onClick={() => onReviewItem(item)} disabled={submitting}>Review &amp; Submit</Button>}
                </section>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  </Dialog>;
}
