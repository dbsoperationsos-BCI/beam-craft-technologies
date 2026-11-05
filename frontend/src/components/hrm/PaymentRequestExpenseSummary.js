"use client";

import SimpleTable from "@/components/data-table/SimpleTable";

const formatAmount = (value) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number(value) || 0);
const formatDate = (value) => value ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(value)) : "—";

/**
 * What a request is made of, read-only: one row per expense line, and what they add up to.
 *
 * Approving releases money, so the person doing it has to see what the total is made of — which
 * shoots it is spread across and what each was for. Without this the approver sees only a figure
 * and a count, and the breakdown that justifies it is reachable only from the database.
 *
 * Every line names the shoot it belongs to, or "General" for one that belongs to none, and the
 * project each shoot sits under is shown beside it, since that is what an approved request is
 * ultimately filed against.
 *
 * `compact` is the narrow side panel: the shoot, what it was for and the amount, stacked. It is the
 * same lines as the table, never a shorter list of them - a reader who sees four lines in one place
 * and three in another trusts neither.
 */
export default function PaymentRequestExpenseSummary({ expenses, compact = false, heading = true }) {
  const lines = Array.isArray(expenses) ? expenses : [];
  if (!lines.length) return <p className="text-xs text-slate-500 sm:text-sm">This request itemises no expenses.</p>;

  const total = lines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0);

  if (compact) {
    return <ul className="space-y-1.5">
      {lines.map((line, index) => <li key={line.id ?? index} className="flex items-baseline justify-between gap-2 text-xs">
        <span className="min-w-0 text-slate-700">
          <span className="font-medium">{line.shootCode || "General"}</span>
          {/* An excess names no expense type - there is nothing it was spent on - so the separator
              goes with it rather than trailing a bare dot. */}
          {line.expenseType ? <span className="text-slate-500"> · {line.expenseType}</span> : null}
          {/*
            * What the line **says**, which this list used to leave out.
            *
            * It showed the shoot, the expense type and the amount, so a line whose description was
            * the whole point of it - which hall, whose transport, what the vendor actually did - read
            * as a bare figure against a shoot code, and the only way to the words was to open the
            * record separately. It is the narrow side panel, so it goes under rather than beside.
            */}
          {line.description ? <span className="block break-words text-[11px] text-slate-500">{line.description}</span> : null}
        </span>
        <span className="shrink-0 font-medium text-slate-900">{formatAmount(line.amount)}</span>
      </li>)}
      <li className="flex items-baseline justify-between gap-2 border-t border-slate-200 pt-1.5 text-xs font-semibold text-slate-900">
        <span>Total</span><span>{formatAmount(total)}</span>
      </li>
    </ul>;
  }

  // The approval panel introduces the table, since it sits among that form's own fields. Inside a
  // card already headed "Expenses" it would only say the same thing twice.
  return <div className={heading ? "mb-4" : ""}>
    {heading && <h3 className="mb-2 text-sm font-medium text-slate-800">What this covers</h3>}
    {/* Scrolls inside its own box rather than pushing the panel sideways at narrow widths. */}
    <SimpleTable
      variant="form"
      classNames={{
        table: "min-w-[34rem]",
        head: "!text-[11px] !tracking-normal !text-slate-600 sm:!text-xs",
        body: "text-xs text-slate-700 sm:text-sm",
        row: "!border-t-slate-200",
      }}
      columns={[
        { key: "shoot", label: "Shoot", cellClassName: "font-medium text-slate-900", render: (line) => <>{line.shootCode || "General"}{line.shootName ? <span className="block text-[11px] font-normal text-slate-500">{line.shootName}</span> : null}</> },
        { key: "project", label: "Project", render: (line) => line.projectCode || "—" },
        { key: "date", label: "Date", render: (line) => formatDate(line.expenseDate) },
        // An excess has no expense type: a dash rather than an empty cell, which reads as missing data.
        { key: "expense", label: "Expense", render: (line) => <>{line.expenseType || "—"}{line.description ? <span className="block text-[11px] text-slate-500">{line.description}</span> : null}</> },
        { key: "amount", label: "Amount", headerClassName: "text-right", cellClassName: "text-right font-medium text-slate-900", render: (line) => formatAmount(line.amount) },
      ]}
      rows={lines}
      rowKey={(line, index) => line.id ?? index}
      footer={(
        <tr className="border-t border-slate-300 bg-slate-50 text-xs font-semibold text-slate-900 sm:text-sm">
          <td className="px-3 py-2" colSpan={4}>Total</td>
          <td className="px-3 py-2 text-right">{formatAmount(total)}</td>
        </tr>
      )}
    />
  </div>;
}
