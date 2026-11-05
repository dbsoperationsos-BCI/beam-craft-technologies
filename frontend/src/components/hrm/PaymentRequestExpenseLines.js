"use client";

import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import Button from "@/components/shared/Button";
import DateField from "@/components/shared/DateField";
import Dropdown from "@/components/shared/Dropdown";
import IconButton from "@/components/shared/IconButton";
import TextField from "@/components/shared/TextField";
import { GENERAL_SHOOT, emptyExpenseLine, shootChoiceLabel } from "@/constants/paymentRequestConfig";

const formatAmount = (value) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(value || 0);

/**
 * The Expenses table a request itemises itself with: one row per thing spent, each naming what it
 * was spent on, when, on what, and how much.
 *
 * A line names one shoot, labelled with the project it belongs to. One picker rather than two: a
 * shoot already knows its project, so asking for the project first and narrowing to it made the
 * reader answer the same question twice. The server reads the project off the shoot and stores
 * both, which is what lets a request spanning several shoots of one project still reach that
 * project's books when it is approved.
 *
 * "General" comes first because plenty of lines have no shoot behind them — a courier, a print run
 * — and forcing one onto those would make the per-shoot totals lie.
 *
 * The running total is shown rather than typed. The legacy form asked for a "Total Expenses
 * Submitted" beside the lines, which is a number that can disagree with the rows above it; the
 * server totals the lines and ignores anything sent, so showing the same sum here is the form
 * telling the truth about what will be saved.
 */
export default function PaymentRequestExpenseLines({ lines, onChange, options, errors = {}, showTotal, totalLabel = "Total Expenses Submitted", disabled = false }) {
  const shootOptions = [
    { value: "", label: GENERAL_SHOOT },
    ...(options.shoots || []).map((shoot) => ({ value: shoot.id, label: shootChoiceLabel(shoot) })),
  ];
  const expenseOptions = (options.expenseTypes || []).map((type) => ({ value: type, label: type }));
  const total = lines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0);

  const update = (index, field, value) => onChange(lines.map((line, lineIndex) => lineIndex === index ? { ...line, [field]: value } : line));
  const add = () => onChange([...lines, { ...emptyExpenseLine }]);
  const remove = (index) => onChange(lines.filter((_, lineIndex) => lineIndex !== index));

  return <div>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h3 className="text-sm font-medium text-slate-800">Expense lines</h3>
        <p className="mt-1 text-xs text-slate-500">{lines.length} line{lines.length === 1 ? "" : "s"} added</p>
      </div>
      <Button type="button" size="sm" variant="secondary" onClick={add} disabled={disabled}>Add New</Button>
    </div>

    {errors.expenses && <p role="alert" className="mb-3 text-xs text-red-600">{errors.expenses}</p>}

    <div className="space-y-4">
      {lines.map((line, index) => <div key={index} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 sm:p-4">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-xs font-semibold text-slate-700 sm:text-sm">Expense {index + 1}</h4>
          {lines.length > 1 && <IconButton label={`Remove expense ${index + 1}`} size="sm" className="text-red-600 hover:bg-red-50" onClick={() => remove(index)} disabled={disabled}>
            <DeleteOutlineIcon sx={{ fontSize: 19 }} />
          </IconButton>}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Dropdown
            searchable
            label="Shoot ID"
            value={line.shootId}
            onChange={(value) => update(index, "shootId", value)}
            options={shootOptions}
            placeholder={GENERAL_SHOOT}
            error={errors[`shootId-${index}`]}
            disabled={disabled}
          />
          <DateField
            required
            label="Expense Date"
            value={line.expenseDate}
            onChange={(value) => update(index, "expenseDate", value)}
            error={errors[`expenseDate-${index}`]}
            restriction="future"
            disabled={disabled}
          />
          <Dropdown
            searchable
            required
            label="Select Expense"
            value={line.expenseType}
            onChange={(value) => update(index, "expenseType", value)}
            options={expenseOptions}
            placeholder="What was it spent on"
            error={errors[`expenseType-${index}`]}
            disabled={disabled}
          />
          <TextField
            required
            label="Expense Amount"
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            placeholder="0.00"
            value={line.amount}
            onChange={(event) => update(index, "amount", event.target.value)}
            error={errors[`amount-${index}`]}
            disabled={disabled}
          />
          <TextField
            className="md:col-span-2"
            label="Description"
            value={line.description}
            onChange={(event) => update(index, "description", event.target.value)}
            placeholder="Optional"
            disabled={disabled}
          />
        </div>
      </div>)}
    </div>

    {showTotal && <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-slate-300 bg-white px-3 py-2.5">
      <span className="text-xs font-semibold text-slate-600 sm:text-sm">{totalLabel}</span>
      <span className="text-sm font-semibold text-slate-900 sm:text-base">{formatAmount(total)}</span>
    </div>}
  </div>;
}
