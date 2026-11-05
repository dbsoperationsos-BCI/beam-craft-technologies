"use client";

import SimpleTable from "@/components/data-table/SimpleTable";
import OptionsMenu from "@/components/ui/OptionsMenu";
import { layers } from "@/constants/layers";
import TextField from "@/components/shared/TextField";
import { CATEGORY_LABELS, amountLabel, formatDay, formatRupees, formatSignedRupees, modifiedSummary } from "@/lib/saleExtras.mjs";

/**
 * The Added or the Removed list of one shoot's Extras card. Every line - published or not - takes its
 * Amount (required) and Remarks in the row itself; `edits` holds what is in the boxes, and Publish
 * Updated Quotation sends it. A published line's box starts at the amount it stands at now: changing
 * it adds a correction in the next revision, and the published line itself never changes. The boxes
 * are there only for whoever may save Edit Sale Details (`canWrite`); anyone else reads the figures.
 *
 * Wider than a phone, so the table scrolls inside its own card; the Item column keeps a reading width
 * rather than breaking a service's name one word to a line.
 */

// The boxes sit inside the Edit Sale Details form: Enter there would submit the whole sale.
const holdEnter = (event) => { if (event.key === "Enter") event.preventDefault(); };

const amountHeader = <>Amount<span aria-hidden="true" className="ml-0.5 text-rose-500">*</span></>;
const shownAmount = (line) => (line.status === "PUBLISHED" ? line.effectiveAmount ?? line.amount : line.amount);
// An item a raised request added: priced on its extra quotation and counted on Payments, so read here only.
const fromExtraQuotation = (line) => line.status === "EXTRA_QUOTATION";
const REMOVED_FROM = { QUOTATION: () => "From the quotation", EXTRA: () => "Added as an extra", EXTRA_QUOTATION: (line) => `From extra quotation ${line.details.reference || ""}`.trim() };
// What a line's ⋮ offers, as the server decides it (`line.action`): the newest line about a service or
// deliverable on its shoot can take it off, the newest about one that is off can put it back.
const ACTION_LABELS = { REMOVE: ["Remove", "Removing..."], ADD_BACK: ["Add back", "Adding back..."] };

// `hideTitle` leaves the heading to the card the table sits in; `title` still names the table for a screen reader.
// `onAction(line, action)` runs a line's ⋮ entry - Remove or Add back; `actingId` is the line on its way.
// The ⋮ is drawn only where `onAction` is given, which the section does for whoever may change the plan.
export default function SaleExtrasItemsTable({ title, hideTitle = false, lines = [], canWrite = false, edits = {}, errors = {}, onEdit, onAction, actingId = "", emptyMessage, showShoot = true }) {
  const valueOf = (line, field) => edits[line.id]?.[field];
  const columns = [
    { key: "item", label: "Item", cellClassName: "min-w-[12rem]", render: (line) => <div className="min-w-0 whitespace-normal">
      <p className="break-words font-normal">{line.itemName}</p>
      {line.kind === "MODIFIED" && <p className="text-xs text-slate-500">Changed: {modifiedSummary(line.details)}</p>}
      {line.included?.length > 0 && <p className="text-xs text-slate-500">Includes: {line.included.map((item) => item.itemName).join(", ")}</p>}
      {/* Where a removed item came from, and the value it stood at - what its Amount starts at. */}
      {line.kind === "ADDED" && line.details?.addedBack && <p className="text-xs text-slate-500">Added back after its removal was published{Number.isFinite(line.details?.value) ? ` · ${line.details.value === 0 ? "complimentary" : formatRupees(line.details.value)}` : ""}</p>}
      {fromExtraQuotation(line) && <p className="text-xs text-slate-500">Extra quotation {line.details?.reference} · {Number(line.amount) === 0 ? "complimentary" : "already counted in Payments"}</p>}
      {line.kind === "REMOVED" && REMOVED_FROM[line.details?.source] && <p className="text-xs text-slate-500">{REMOVED_FROM[line.details.source](line)}{Number.isFinite(line.details?.value) ? ` · ${line.details.value === 0 ? "complimentary" : formatRupees(line.details.value)}` : ""}</p>}
    </div> },
    { key: "category", label: "Category", render: (line) => CATEGORY_LABELS[line.category] || line.category },
    // Left out inside a shoot's own card, which already names the shoot.
    ...(showShoot ? [{ key: "shoot", label: "Related Shoot", cellClassName: "min-w-[6.5rem] whitespace-normal", render: (line) => <span>
      {line.shootName || "—"}
      {Boolean(line.shootCode) && <span className="block text-xs tabular-nums text-slate-500">{line.shootCode}</span>}
    </span> }] : []),
    { key: "date", label: "Created", cellClassName: "whitespace-nowrap", render: (line) => formatDay(line.changedAt) },
    { key: "amount", label: amountHeader, headerClassName: "text-right", cellClassName: "min-w-[7.5rem] text-right font-semibold tabular-nums", render: (line) => (canWrite && !fromExtraQuotation(line)
      ? <TextField
        aria-label={`${amountLabel(line.kind)} for ${line.itemName}`}
        // Required is said and checked by the section on Publish - never the browser's own `required`,
        // which would stop Update Project for the whole sale over an Extra amount.
        aria-required="true"
        type="number"
        inputMode="decimal"
        step="0.01"
        min={line.kind === "ADDED" || line.kind === "REMOVED" ? 0 : undefined}
        prefix="₹"
        placeholder="0"
        onKeyDown={holdEnter}
        value={valueOf(line, "amount") ?? ""}
        error={errors[line.id] || ""}
        inputClassName="text-right"
        onChange={(event) => onEdit?.(line, "amount", event.target.value)}
      />
      : shownAmount(line) === null ? <span className="font-normal text-amber-700">Not set</span> : formatSignedRupees(shownAmount(line))) },
    { key: "remarks", label: "Remarks", cellClassName: "min-w-[9rem] whitespace-normal", render: (line) => (canWrite && !fromExtraQuotation(line)
      ? <TextField aria-label={`Remarks for ${line.itemName}`} maxLength={2000} placeholder="Internal note" value={valueOf(line, "remarks") ?? ""} onKeyDown={holdEnter} onChange={(event) => onEdit?.(line, "remarks", event.target.value)} />
      : <span>{line.remarks || "—"}</span>) },
    ...(onAction && lines.some((line) => ACTION_LABELS[line.action]) ? [{ key: "actions", label: "Actions", srOnly: true, cellClassName: "w-px whitespace-nowrap text-right", render: (line) => (ACTION_LABELS[line.action]
      ? <OptionsMenu ariaLabel={`Actions for ${line.itemName}`} menuZIndexClassName={layers.menuOverPanel} items={[{
        label: ACTION_LABELS[line.action][actingId === line.id ? 1 : 0],
        tone: line.action === "REMOVE" ? "danger" : undefined,
        disabled: Boolean(actingId),
        onSelect: () => onAction(line, line.action),
      }]} />
      : null) }] : []),
  ];
  return <div className="min-w-0 space-y-2">
    {!hideTitle && <h4 className="text-sm font-semibold text-slate-800">{title} <span className="font-normal text-slate-500">({lines.length})</span></h4>}
    <SimpleTable columns={columns} rows={lines} ariaLabel={title} emptyMessage={emptyMessage} />
  </div>;
}
