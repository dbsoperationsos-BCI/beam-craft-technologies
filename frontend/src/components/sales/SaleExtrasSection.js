"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import PublishOutlinedIcon from "@mui/icons-material/PublishOutlined";
import Button from "@/components/shared/Button";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import Loader from "@/components/shared/Loader";
import StatTile from "@/components/shared/StatTile";
import { useUnloadWarning } from "@/components/shared/useUnsavedGuard";
import useSubmitOnce from "@/components/shared/useSubmitOnce";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { KIND_LABELS, amountEntryProblem, currentLines, formatRupees, formatSignedRupees, round2, signedFromTyped, splitAddedRemoved, typedAmount } from "@/lib/saleExtras.mjs";
import { getSaleExtras, publishSaleExtras, removeSaleExtra, restoreSaleExtra } from "@/services/sales/sale-extras.service";
import { usePermissions } from "@/components/auth/PermissionsProvider";
import SaleExtrasShootCard from "./SaleExtrasShootCard";

/**
 * EXTRA – ADDITIONAL & REMOVED ITEMS, in Edit Sale Details above Shedule Payment.
 *
 * Extras: a card per shoot, drawn as Service Creation draws it, listing only what changed from the
 * finalized quotation since it was pushed into the project - every shoot, service and deliverable
 * added, removed or re-scoped, each a line of its own, recorded by the server from the project's rows
 * whichever screen changed them - under the card's Added and Removed. Every line has an Amount box
 * (required; an addition positive, a removal as the reduction; ₹0 is an amount) and a Remarks box.
 *
 * Nothing is saved until **Publish Updated Quotation**, which is open whenever something changed - a
 * line waiting to be published, or an edit to a published one - and sends what is in the boxes: the
 * waiting lines' amounts and remarks, and the published lines' edits, which the server records as
 * corrections (a published line itself never changes). It then shows on the client's existing
 * quotation link; nothing is sent to the client, and the original quotation is never changed. Typed
 * values stay on screen until then: the page warns before it is refreshed or closed, and the panel
 * (`onUnsavedChange`) asks before it closes. While Publish is open the panel holds Update Project
 * (`onPublishPendingChange`).
 *
 * Shown only for a project booked on a finalized quotation (`tracked`). Typing and publishing are for
 * whoever may save Edit Sale Details - `canWrite`, decided by the panel - and absent without it.
 *
 * `planSignature` changes whenever Service Creation changes a row, and the section reloads to match.
 */

// What a line's boxes hold before anything is typed: its amount as the studio types it (a published
// line's as it stands after its corrections), and its remarks.
const startingValues = (line) => ({
  amount: typedAmount(line.status === "PUBLISHED" ? { ...line, amount: line.effectiveAmount ?? line.amount } : line),
  remarks: line.remarks || "",
});
const differs = (typed, start) => String(typed.amount).trim() !== start.amount || typed.remarks.trim() !== start.remarks.trim();

// The section's two headings, in this order: what was added since booking (additions, and changed
// scopes), then what was removed - each listing the shoots it happened on, a table per shoot.
const GROUPS = [
  { key: "added", title: "Added", empty: "Nothing added since booking." },
  { key: "removed", title: "Removed", empty: "Nothing removed since booking." },
];

// Every button here is `type="button"`: the section renders inside the Edit Sale Details form, where
// the shared Button would otherwise submit it - saving and closing the panel on a click.
// `onPlanChanged` runs after Restore puts a line back on its shoot, so Service Creation reads it again.
export default function SaleExtrasSection({ projectId, planSignature = "", canWrite = false, onPublishedChange, onUnsavedChange, onPublishPendingChange, onPlanChanged }) {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  // What is in the boxes, by line id: { amount, remarks } - kept until it is published.
  const [edits, setEdits] = useState({});
  const [errors, setErrors] = useState({});
  const [confirming, setConfirming] = useState(false);
  const { notice, showSuccess, showError, clearNotice } = useNotice();
  const [actingId, setActingId] = useState("");
  /*
   * Remove and Add back change the project's shoots exactly as Service Creation does, so they are offered
   * to whoever may change those - PROJECT / Projects, or Show All Projects, at Read / Write - which is
   * what the server asks (`plansAProject`).
   */
  const { hasAnyPermission } = usePermissions();
  const canChangePlan = canWrite && hasAnyPermission([{ module: "PROJECT", feature: "Projects", level: "READ_WRITE" }, { module: "PROJECT", feature: "Show All Projects", level: "READ_WRITE" }]);
  const publishing = useSubmitOnce();

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const result = await getSaleExtras(projectId);
      const data = result?.data || null;
      setState(data);
      // Typed values stay with the lines still on screen; any other is gone.
      const shown = new Set((data?.lines || []).map((line) => line.id));
      setEdits((current) => Object.fromEntries(Object.entries(current).filter(([id]) => shown.has(id))));
      // Shedule Payment shows the published Net Extra from this same answer, once anything is published.
      onPublishedChange?.(data?.tracked && data.publishedCount > 0 ? { net: data.publishedNet } : null);
    } catch (error) {
      setLoadError(error.message || "Unable to load the extras.");
    } finally {
      setLoading(false);
    }
  }, [projectId, onPublishedChange]);

  // Reloaded a moment after Service Creation settles, so a burst of edits reads once.
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 400);
    return () => window.clearTimeout(timer);
  }, [load, planSignature]);

  // A correction is folded into the line it corrects (its box shows where the line stands now).
  const lines = useMemo(() => (state?.lines || []).filter((line) => line.kind !== "CORRECTION"), [state]);
  const waiting = useMemo(() => lines.filter((line) => line.status === "DRAFT"), [lines]);
  const values = useMemo(() => Object.fromEntries(lines.map((line) => [line.id, edits[line.id] || startingValues(line)])), [lines, edits]);
  // Published lines whose boxes were changed - their edits go with the next publish.
  const editedPublished = useMemo(() => lines.filter((line) => line.status === "PUBLISHED" && edits[line.id] && differs(edits[line.id], startingValues(line))), [lines, edits]);
  // Corrections not yet published, from before the boxes took edits, go out with the next publish too.
  const pendingCorrections = useMemo(() => (state?.lines || []).filter((line) => line.kind === "CORRECTION" && line.status === "DRAFT"), [state]);
  const unsaved = lines.some((line) => edits[line.id] && differs(edits[line.id], startingValues(line)));
  const hasChanges = waiting.length > 0 || editedPublished.length > 0 || pendingCorrections.length > 0;
  useEffect(() => { onUnsavedChange?.(unsaved); }, [unsaved, onUnsavedChange]);
  useEffect(() => () => onUnsavedChange?.(false), [onUnsavedChange]);
  // Whether Publish Updated Quotation is open here - the panel holds Update Project while it is.
  const publishPending = canWrite && Boolean(state?.tracked) && hasChanges;
  useEffect(() => { onPublishPendingChange?.(publishPending); }, [publishPending, onPublishPendingChange]);
  useEffect(() => () => onPublishPendingChange?.(false), [onPublishPendingChange]);
  useUnloadWarning(canWrite, () => unsaved);

  // Each shoot something changed on, its lines split into Added and Removed - drawn under the section's
  // two headings, a card per shoot under each; a line whose shoot is no longer on record is drawn as a
  // shoot of its own at the end. Each item once, at its latest line (`currentLines`).
  const cards = useMemo(() => {
    const shown = currentLines(lines);
    const shoots = state?.extraShoots || [];
    const known = new Set(shoots.map((shoot) => shoot.id));
    const groups = shoots.map((shoot) => ({ shoot, lines: shown.filter((line) => line.shootRef === shoot.id) }));
    const other = shown.filter((line) => !known.has(line.shootRef));
    if (other.length) groups.push({ shoot: { id: "other", name: "Other changes", status: null }, lines: other });
    return groups.filter((group) => group.lines.length).map((group) => ({ shoot: group.shoot, ...splitAddedRemoved(group.lines) }));
  }, [state, lines]);

  const editLine = (line, field, value) => {
    setEdits((current) => ({ ...current, [line.id]: { ...(current[line.id] || startingValues(line)), [field]: value } }));
    setErrors((current) => ({ ...current, [line.id]: "" }));
  };

  // What this publish adds to the published net: each waiting line as typed, each edited published
  // line by the difference from where it stands, and any correction already waiting.
  const signedTyped = (line) => signedFromTyped(line.kind, values[line.id]?.amount);
  const publishNet = round2(
    waiting.reduce((sum, line) => sum + (signedTyped(line) ?? 0), 0)
    + editedPublished.reduce((sum, line) => sum + ((signedTyped(line) ?? 0) - Number(line.effectiveAmount ?? line.amount ?? 0)), 0)
    + pendingCorrections.filter((line) => !editedPublished.some((edited) => edited.id === line.correctsExtraId)).reduce((sum, line) => sum + Number(line.amount || 0), 0),
  );

  // Every amount is required: a waiting line's box and an edited published line's box.
  const openReview = () => {
    const problems = Object.fromEntries([...waiting, ...editedPublished].map((line) => {
      const typed = String(values[line.id]?.amount ?? "").trim();
      return [line.id, typed === "" ? "Enter the amount." : amountEntryProblem(line.kind, typed)];
    }).filter(([, problem]) => problem));
    setErrors(problems);
    if (Object.keys(problems).length) return showError("Enter every amount before publishing - ₹0 where there is no charge.");
    return setConfirming(true);
  };

  const publish = () => publishing.run(async () => {
    const entry = (line) => {
      const typed = values[line.id];
      return { id: line.id, amount: Number(String(typed.amount).trim()), remarks: typed.remarks.trim() || null };
    };
    try {
      const result = await publishSaleExtras(projectId, {
        draftIds: (state?.lines || []).filter((line) => line.status === "DRAFT").map((line) => line.id),
        reviewed: Object.fromEntries((state?.lines || []).filter((line) => line.status === "DRAFT").map((line) => [line.id, line.updatedAt])),
        expectedRevision: state?.latestRevisionNumber || 0,
        lines: waiting.map(entry),
        // Only what moved: a published line whose remarks alone changed sends only its remarks.
        published: editedPublished.map((line) => {
          const sent = entry(line);
          return String(values[line.id].amount).trim() === startingValues(line).amount ? { id: sent.id, remarks: sent.remarks } : sent;
        }),
      });
      setEdits({});
      setConfirming(false);
      const token = state?.quotation?.publicToken;
      showSuccess(result?.message || "Published. The client's quotation link now shows it.", token && !result?.data?.remarksOnly ? { label: "Open client link", onSelect: () => window.open(`/q/${encodeURIComponent(token)}`, "_blank", "noopener") } : undefined);
    } catch (error) {
      // Nothing was kept on a refusal; the review stays open with the reason, and the boxes keep what was typed.
      showError(error.data?.message || error.message || "Unable to publish the updated quotation.");
    }
    await load();
  });

  if (loading) return <Loader label="Loading extras..." />;
  if (loadError) return <div className="space-y-2">
    <p role="alert" className="text-sm text-red-700">{loadError}</p>
    <Button type="button" size="sm" onClick={() => { setLoading(true); void load(); }}>Try Again</Button>
  </div>;
  if (!state?.tracked) return <p className="text-sm text-slate-500">This project is not booked on a finalized quotation, so changes to its shoots, services and deliverables are not tracked as extras. Link a finalized quotation to the sale to track them.</p>;

  const review = splitAddedRemoved(waiting);
  const reviewList = (title, items, amountOf) => items.length > 0 && <div className="space-y-1">
    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
    <ul className="space-y-1.5 text-sm">
      {items.map((line) => <li key={line.id} className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 break-words text-slate-700">
          {line.itemName} · {line.kind === "MODIFIED" ? "Changed" : KIND_LABELS[line.kind]}
          {Boolean(values[line.id]?.remarks.trim()) && <span className="block text-xs text-slate-500">{values[line.id].remarks.trim()}</span>}
        </span>
        <span className="shrink-0 tabular-nums font-medium">{amountOf(line)}</span>
      </li>)}
    </ul>
  </div>;
  const typedText = (line) => formatSignedRupees(signedTyped(line) ?? 0);
  const correctionText = (line) => `${formatSignedRupees(line.effectiveAmount ?? line.amount)} → ${formatSignedRupees(signedTyped(line) ?? 0)}`;
  /*
   * A line's ⋮: Remove takes the item off its shoot (an addition never published simply goes; anything
   * else becomes a Removed line at the value it stood at), Add back puts it back exactly as it was - a
   * quoted item as quoted, an extra at the amount it was added at, or, after a published removal, as an
   * addition at the value it had. As often as needed. Service Creation is read again to match.
   */
  const actOnLine = async (line, action) => {
    setActingId(line.id);
    try {
      const result = await (action === "REMOVE" ? removeSaleExtra : restoreSaleExtra)(projectId, line.id);
      showSuccess(result?.message || (action === "REMOVE" ? `${line.itemName} is off the shoot.` : `${line.itemName} is back on the shoot.`));
      await load();
      onPlanChanged?.();
    } catch (error) {
      showError(error.data?.message || error.message || (action === "REMOVE" ? "Unable to remove the item." : "Unable to add the item back."));
    } finally {
      setActingId("");
    }
  };
  const tableProps = { canWrite, edits: values, errors, onEdit: editLine, onAction: canChangePlan ? actOnLine : undefined, actingId };
  // What the project now comes to: the quotation, the published extras, and the approved extra
  // quotations (counted on Payments, listed here as already counted) - the figure Payments shows too.
  const extraQuotationTotal = Number(state.extraQuotationTotal || 0);
  const projectTotal = Number(state.updatedTotal || 0) + extraQuotationTotal;
  const summary = [
    ["Original", formatRupees(state.quotation.amount)],
    ["Unpublished", formatSignedRupees(publishNet)],
    ["Published", formatSignedRupees(state.publishedNet)],
    ["Updated Total", formatRupees(projectTotal)],
  ];

  return <div className="space-y-4">
    {/* The figures, first and held under the section's own sticky title while its cards scroll past
        beneath them. Sticky to this section only, so scrolling on into Shedule Payment takes them away
        with it. The offset is the title bar's height (SchemaFormSection: py-3.5, text-base / sm:text-lg,
        a 1px rule); the bar is opaque and spans the section's padding so nothing shows through. */}
    <section aria-label="Financial summary" className="sticky top-[53px] z-10 -mx-4 -mt-4 border-b border-slate-200 bg-white px-4 py-2 sm:top-[57px] sm:-mx-6 sm:-mt-5 sm:px-6 sm:py-3">
      {/* On a phone the four figures as one tight list, so the held bar stays short; tiles from sm. */}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:hidden">
        {summary.map(([label, value]) => <div key={label} className="flex min-w-0 items-baseline justify-between gap-2">
          <dt className="truncate text-slate-500">{label}</dt>
          <dd className="shrink-0 font-semibold tabular-nums text-slate-900">{value}</dd>
        </div>)}
      </dl>
      <div className="hidden gap-3 sm:grid sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Original Amount" value={formatRupees(state.quotation.amount)}>{`Finalized quotation V${state.quotation.version} · never changes`}</StatTile>
        <StatTile label="Unpublished Extra" value={formatSignedRupees(publishNet)}>{hasChanges ? "Not yet published" : "Nothing waiting"}</StatTile>
        <StatTile label="Published Extra" value={formatSignedRupees(state.publishedNet)}>{state.revisions.length ? "Net extra published so far" : "None published yet"}</StatTile>
        <StatTile label="Updated Total" value={formatRupees(projectTotal)}>{extraQuotationTotal ? `Before GST · incl. ${formatRupees(extraQuotationTotal)} extra quotations` : "Before GST"}</StatTile>
      </div>
    </section>

    <section aria-label="Extras" className="min-w-0 space-y-4">
      {cards.length === 0 && <p className="text-sm text-slate-500">Nothing has been added, removed or changed since booking. Changes made in Service Creation appear here, shoot by shoot.</p>}
      {cards.length > 0 && GROUPS.map(({ key, title, empty }) => {
        const shoots = cards.filter((card) => card[key].length);
        const count = shoots.reduce((sum, card) => sum + card[key].length, 0);
        return <section key={key} aria-label={title} className="min-w-0 space-y-3">
          <h3 className="text-lg font-semibold text-slate-900">{title} <span className="font-normal text-slate-500">({count})</span></h3>
          {shoots.length === 0 && <p className="text-sm text-slate-500">{empty}</p>}
          {shoots.map((card) => <SaleExtrasShootCard key={card.shoot.id} shoot={card.shoot} group={title} lines={card[key]} {...tableProps} />)}
        </section>;
      })}
    </section>

    {canWrite && <div className="flex flex-wrap items-center justify-end gap-3">
      {!hasChanges && <p className="text-xs text-slate-500">Nothing new to publish.</p>}
      <Button type="button" variant="primary" className="gap-1.5" disabled={!hasChanges} onClick={openReview}>
        <PublishOutlinedIcon aria-hidden="true" sx={{ fontSize: 16 }} />Publish Updated Quotation
      </Button>
    </div>}

    <ConfirmDialog
      open={confirming}
      title="Publish the updated quotation?"
      message="Shows these changes on the client's existing quotation link, without their prices; nothing is sent. The original quotation is never changed."
      confirmLabel="Publish Updated Quotation"
      busyLabel="Publishing..."
      tone="primary"
      loading={publishing.busy}
      onCancel={() => setConfirming(false)}
      onConfirm={() => void publish()}
    >
      <div className="max-h-72 space-y-3 overflow-y-auto">
        {reviewList("Added Items", review.added.filter((line) => line.kind !== "MODIFIED"), typedText)}
        {reviewList("Removed Items", review.removed, typedText)}
        {reviewList("Changed Items", review.added.filter((line) => line.kind === "MODIFIED"), typedText)}
        {reviewList("Corrected Amounts", editedPublished.filter((line) => String(values[line.id].amount).trim() !== startingValues(line).amount), correctionText)}
        {reviewList("Remarks Updated", editedPublished.filter((line) => String(values[line.id].amount).trim() === startingValues(line).amount), (line) => formatSignedRupees(line.effectiveAmount ?? line.amount))}
      </div>
      <dl className="mt-3 space-y-1 border-t border-slate-200 pt-3 text-sm">
        <div className="flex justify-between gap-3"><dt className="text-slate-600">Original finalized amount</dt><dd className="tabular-nums">{formatRupees(state.quotation.amount)}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-slate-600">Net adjustment (this publish)</dt><dd className="tabular-nums">{formatSignedRupees(publishNet)}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-slate-600">Net extra after publishing</dt><dd className="tabular-nums">{formatSignedRupees(state.publishedNet + publishNet)}</dd></div>
        <div className="flex justify-between gap-3 font-semibold"><dt>Updated total (before GST)</dt><dd className="tabular-nums">{formatRupees(state.updatedTotal + publishNet)}</dd></div>
      </dl>
    </ConfirmDialog>

    <FloatingNotice notice={notice} onClose={clearNotice} />
  </div>;
}
