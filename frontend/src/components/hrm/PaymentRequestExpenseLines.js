"use client";

import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import Button from "@/components/shared/Button";
import DateField from "@/components/shared/DateField";
import Dropdown from "@/components/shared/Dropdown";
import IconButton from "@/components/shared/IconButton";
import TextField from "@/components/shared/TextField";
import useRemoteOptions from "@/components/shared/useRemoteOptions";
import { searchPaymentRequestShoots } from "@/services/hrm/payment-requests.service";
import { GENERAL_SHOOT, emptyExpenseLine, expenseLineWording, shootChoiceLabel } from "@/constants/paymentRequestConfig";

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
 * **The shoot is searched on the server.** `options.shoots` is only what the picker opens on - the
 * nearest fifty - and typing asks `searchPaymentRequestShoots` over every shoot the studio has. It
 * used to filter a list of two hundred sent up front, which on a studio with a few hundred shoots
 * meant the rest could not be named at all: the oldest went first, so an imported back catalogue was
 * exactly what a line could not be filed against, and the menu said "No options available" as though
 * the shoot did not exist. A shoot already chosen is kept in the list whatever the search comes back
 * with, or re-rendering would blank the answer on the line.
 *
 * `wording` is what the boxes are called, which is not one set of words: money already spent, money
 * wanted before it is spent, and unspent money being handed back are three different questions, and
 * `expenseLineWording` holds the three. An excess is not asked what it was spent on at all — there
 * is nothing it was spent on — so that box is **absent** rather than present and ignored.
 *
 * The running total is shown rather than typed. The legacy form asked for a "Total Expenses
 * Submitted" beside the lines, which is a number that can disagree with the rows above it; the
 * server totals the lines and ignores anything sent, so showing the same sum here is the form
 * telling the truth about what will be saved.
 */
export default function PaymentRequestExpenseLines({ lines, onChange, options, errors = {}, showTotal, wording = expenseLineWording(), datesFollowShoot = false, disabled = false }) {
  /*
   * The shoot is searched on the server, and the hook holds the one part that is easy to get wrong:
   * a line stores the shoot's **id**, and its label comes from a list the next search replaces, so a
   * shoot already chosen has to be kept in the options or the line reads as blank while still saving
   * correctly. See `useRemoteOptions`.
   */
  const shoots = useRemoteOptions(searchPaymentRequestShoots, { read: (data) => data.shoots });
  const shootOptions = shoots.optionsFor(
    options.shoots || [],
    lines.map((line) => line.shootId),
    shootChoiceLabel,
    [{ value: "", label: GENERAL_SHOOT }],
  );
  const expenseOptions = (options.expenseTypes || []).map((type) => ({ value: type, label: type }));
  const total = lines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0);

  /**
   * The shoot's own day, as the `YYYY-MM-DD` key `DateField` holds.
   *
   * Cut from the stored string rather than read through `new Date()`: a shoot's day is kept at
   * midnight, so turning it into a local date would move it to the day before for anybody west of
   * UTC - which on a vendor's bill is the wrong date on the studio's books.
   */
  const shootDateKey = (shoot) => String(shoot?.dateCreated || "").slice(0, 10);
  // The shoot behind a line's id, from the hook that holds every row a search has offered.
  const shootRow = (id) => shoots.rowFor(id, options.shoots || []);

  /*
   * A vendor's bill is for a shoot, so picking the shoot fills the date in (`datesFollowShoot`) -
   * it was being typed again from the row above it.
   *
   * **It does not overwrite a date somebody typed.** Filled when the box is empty, and when it still
   * holds the day of the shoot being replaced - which is to say when the app put it there. Anything
   * else is an answer, and a picker that quietly rewrites one teaches people to check it every time.
   */
  const update = (index, field, value) => onChange(lines.map((line, lineIndex) => {
    if (lineIndex !== index) return line;
    const next = { ...line, [field]: value };
    if (!datesFollowShoot || field !== "shootId") return next;
    const chosen = shootRow(value);
    const was = line.shootId ? shootDateKey(shootRow(line.shootId)) : "";
    const typed = line.expenseDate && line.expenseDate !== was;
    if (chosen && !typed) next.expenseDate = shootDateKey(chosen) || line.expenseDate;
    return next;
  }));
  const add = () => onChange([...lines, { ...emptyExpenseLine }]);
  const remove = (index) => onChange(lines.filter((_, lineIndex) => lineIndex !== index));

  return <div>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h3 className="text-sm font-medium text-slate-800">{wording.heading}</h3>
        <p className="mt-1 text-xs text-slate-500">{lines.length} line{lines.length === 1 ? "" : "s"} added</p>
      </div>
      <Button type="button" size="sm" variant="secondary" onClick={add} disabled={disabled}>Add New</Button>
    </div>

    {errors.expenses && <p role="alert" className="mb-3 text-xs text-red-600">{errors.expenses}</p>}

    <div className="space-y-4">
      {lines.map((line, index) => <div key={index} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 sm:p-4">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-xs font-semibold text-slate-700 sm:text-sm">{wording.item} {index + 1}</h4>
          {lines.length > 1 && <IconButton label={`Remove ${wording.item.toLowerCase()} ${index + 1}`} size="sm" className="text-red-600 hover:bg-red-50" onClick={() => remove(index)} disabled={disabled}>
            <DeleteOutlineIcon sx={{ fontSize: 19 }} />
          </IconButton>}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Dropdown
            searchable
            label="Shoot ID"
            helperText={wording.shootHelp}
            value={line.shootId}
            onChange={(value) => update(index, "shootId", value)}
            options={shootOptions}
            {...shoots.props}
            placeholder={GENERAL_SHOOT}
            error={errors[`shootId-${index}`]}
            disabled={disabled}
          />
          <DateField
            required
            label={wording.dateLabel}
            helperText={datesFollowShoot && line.shootId && line.expenseDate === shootDateKey(shootRow(line.shootId))
              ? "Taken from the shoot's own day. Change it if the bill is dated differently."
              : wording.dateHelp}
            value={line.expenseDate}
            onChange={(value) => update(index, "expenseDate", value)}
            error={errors[`expenseDate-${index}`]}
            restriction={wording.dateRestriction}
            disabled={disabled}
          />
          {wording.asksExpenseType && <Dropdown
            searchable
            required
            label="Select Expense"
            helperText={wording.typeHelp}
            value={line.expenseType}
            onChange={(value) => update(index, "expenseType", value)}
            options={expenseOptions}
            placeholder={wording.typePlaceholder}
            error={errors[`expenseType-${index}`]}
            disabled={disabled}
          />}
          <TextField
            // Spans the row when the expense type box is gone, so an excess does not read as a
            // half-filled grid with an empty cell where a question used to be.
            className={wording.asksExpenseType ? "" : "md:col-span-2"}
            required
            label={wording.amountLabel}
            helperText={wording.amountHelp}
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
            helperText={wording.descriptionHelp}
            value={line.description}
            onChange={(event) => update(index, "description", event.target.value)}
            placeholder="Optional"
            disabled={disabled}
          />
        </div>
      </div>)}
    </div>

    {showTotal && <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-slate-300 bg-white px-3 py-2.5">
      <span className="text-xs font-semibold text-slate-600 sm:text-sm">{wording.total}</span>
      <span className="text-sm font-semibold text-slate-900 sm:text-base">{formatAmount(total)}</span>
    </div>}
  </div>;
}
