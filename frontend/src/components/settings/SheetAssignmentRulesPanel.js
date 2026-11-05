"use client";

import { useMemo } from "react";
import Dropdown from "@/components/shared/Dropdown";
import TextField from "@/components/shared/TextField";
import Button from "@/components/shared/Button";
import IconButton from "@/components/shared/IconButton";
import ArrowUpwardRoundedIcon from "@mui/icons-material/ArrowUpwardRounded";
import ArrowDownwardRoundedIcon from "@mui/icons-material/ArrowDownwardRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import { MAX_TARGETS, emptyRule, emptyTarget, evenShares, ruleIssue, shareTotal } from "@/lib/sheetAssignmentRules.mjs";

/**
 * Who a linked sheet's leads are assigned to, as an ordered list of rules.
 *
 * A spreadsheet says who a lead is; it almost never says whose lead it is. The studio's answer has
 * always been a person reading a column - "anything from the Coimbatore page is Divya's" - and
 * assigning by hand, which nobody keeps up with on a sheet the poller re-reads every two minutes.
 * One row here is that reading written down: a column, a condition, and the employee whose lead it
 * is when the two meet.
 *
 * Three things about the shape of this, each of which is a decision rather than a style:
 *
 *   1. **The column is typed, with the sheet's real headings offered as suggestions.** A typo is a
 *      rule that silently never fires, and a rule that never fires is indistinguishable from no
 *      rule - so the headings are offered wherever they are known. They are not always: a sheet
 *      being linked has never been read, and one whose share was revoked cannot be. The import
 *      preview names any column a rule asks for that the sheet does not have, which is the check
 *      that works in every one of those cases.
 *   2. **Order is the answer to two rules matching one row**, so it is editable here rather than
 *      inferred. The first match wins and evaluation stops.
 *   3. **Nothing here enforces anything.** The backend validates the same rules again and is the
 *      only authority; this is what makes the list correctable before it is sent.
 */

/*
 * Layout: the condition is one line - column, value, and the control that splits the rule - with
 * the people it goes to listed under it and the rule's own reorder and remove controls under them.
 * Stacked below `sm`, where two fields side by side leave each too narrow to read its own answer.
 */
/*
 * The wording is the CRM's by default and is what the Sales integration still reads. The Interview
 * integration passes its own `noun` - "candidate" - and its own `ownerLabel`, since a sheet there
 * assigns an interviewer rather than a CRM; the rules, the fields and the checks are the same.
 */
export default function SheetAssignmentRulesPanel({
  rules = [],
  onChange,
  employees = [],
  headers = [],
  disabled = false,
  className = "",
  noun = "lead",
  nounPlural = `${noun}s`,
  ownerLabel = "CRM",
}) {
  const employeeOptions = useMemo(
    () => employees.map((employee) => ({ value: String(employee.id), label: employee.employeeName || employee.employeeId || String(employee.id) })),
    [employees],
  );
  /*
   * The sheet's own headings, offered as suggestions under the column field.
   *
   * Suggestions rather than a menu, because the field has to work when there are none. The
   * headings are only known once this sheet has been read: a link being created has never been
   * read, the read lands a second or two after the dialog opens, and a sheet whose share was
   * revoked can never be read at all. A control that was a menu in one of those cases and a text
   * box in the others - and changed from one to the other mid-edit - was the same field wearing
   * three faces. One field now, which simply knows more once the headings arrive.
   */
  const headerSuggestions = useMemo(
    () => headers.map((header) => String(header || "").trim()).filter(Boolean),
    [headers],
  );

  const update = (index, patch) => {
    onChange(rules.map((rule, position) => (position === index ? { ...rule, ...patch } : rule)));
  };

  const updateTarget = (ruleIndex, targetIndex, patch) => {
    const rule = rules[ruleIndex];
    update(ruleIndex, { targets: rule.targets.map((target, i) => (i === targetIndex ? { ...target, ...patch } : target)) });
  };

  /*
   * Adding or removing a person re-spreads the shares evenly.
   *
   * The total has to be 100 and nobody should have to do the arithmetic to get there: splitting a
   * rule between two people means 50/50 until it is changed, and removing one of three puts the
   * other two back on 50/50 rather than leaving a rule that adds to 66 and refuses to save.
   */
  const setTargets = (ruleIndex, targets) => {
    const shares = evenShares(targets.length);
    update(ruleIndex, { targets: targets.map((target, i) => ({ ...target, percent: String(shares[i]) })) });
  };

  const move = (index, by) => {
    const next = [...rules];
    const target = index + by;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  return (
    <div className={`rounded-lg border border-slate-200 bg-slate-50/60 p-3 sm:p-4 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-xs font-semibold text-slate-700 sm:text-sm">Assign {nounPlural} to</h4>
          <p className="mt-0.5 text-[11px] leading-4 text-slate-500 sm:text-xs">
            Checked top to bottom on every sync; the first rule that matches assigns the {noun}. A {noun}
            whose sheet names {/^[aeiou]/i.test(ownerLabel) ? "an" : "a"} {ownerLabel}, or that somebody has already reassigned here, is left alone.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="whitespace-nowrap"
          disabled={disabled}
          // On top, not at the bottom: a new rule is the one being written, and the list is checked
          // top to bottom - so the thing just added is also the first thing tried, which is what
          // somebody adding a more specific rule almost always means.
          onClick={() => onChange([emptyRule(), ...rules])}
        >
          + Add rule
        </Button>
      </div>

      {rules.length ? (
        <ol className="mt-3 space-y-2">
          {rules.map((rule, index) => {
            const issue = ruleIssue(rule);
            return (
              <li key={index} className="rounded-lg border border-slate-200 bg-white p-3">
                {/* ── The condition, and what the rule as a whole does ────────────────────────
                    Two fields, not three. There used to be an "Assign to" column here whose only
                    content was the words "Shared between 2, below." - a third of the row spent
                    pointing at the list directly underneath it. The list is the answer; it does
                    not need announcing. */}
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
                    <TextField
                      label="Sheet column"
                      placeholder="Column heading"
                      value={rule.columnHeader}
                      disabled={disabled}
                      suggestions={headerSuggestions}
                      onChange={(event) => update(index, { columnHeader: event.target.value })}
                    />
                    <TextField
                      label="Value"
                      placeholder="Chennai"
                      value={rule.matchValue}
                      disabled={disabled}
                      onChange={(event) => update(index, { matchValue: event.target.value })}
                    />
                  </div>
                  {/* Beside the rule's own fields, because splitting is something done *to* this
                      rule while writing it. */}
                  <div className="flex shrink-0 items-center justify-end sm:pb-0.5">
                    {rule.targets.length < MAX_TARGETS && (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="whitespace-nowrap"
                        disabled={disabled}
                        onClick={() => setTargets(index, [...rule.targets, emptyTarget()])}
                      >
                        + Split
                      </Button>
                    )}
                  </div>
                </div>

                {/* ── Who the leads go to ─────────────────────────────────────────────────────
                    One heading over the whole list rather than a column header row on top of the
                    card's own: "Sheet column / Value / Assign to" and then "Employee / Percent"
                    was two sets of headings in one box, and neither earned the line it sat on.

                    The percentage only appears once a rule is shared. One person takes everything
                    by definition, and a box reading 100 next to them is a sum nobody needs. */}
                <div className="mt-3 rounded-md bg-slate-50 px-2.5 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-slate-600">Goes to</span>
                    {rule.targets.length > 1 && (
                      /* Green only when the whole rule is good: the total alone read 100% in green
                         beside a share with nobody picked, which says the rule is ready while the
                         message below says it is not. */
                      <span className={`text-[11px] font-medium ${shareTotal(rule) === 100 && !issue ? "text-emerald-600" : "text-amber-700"}`}>
                        Total {shareTotal(rule)}%
                      </span>
                    )}
                  </div>
                  <ul className="mt-1.5 space-y-1.5">
                    {rule.targets.map((target, targetIndex) => (
                      <li key={targetIndex} className="flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <Dropdown
                            mode="input"
                            label=""
                            className="[&>span]:hidden [&>*]:mt-0"
                            ariaLabel={`Employee ${targetIndex + 1} for rule ${index + 1}`}
                            placeholder="Select an employee"
                            searchable
                            value={target.employeeId ? String(target.employeeId) : ""}
                            disabled={disabled}
                            onChange={(value) => updateTarget(index, targetIndex, { employeeId: value })}
                            /* Whoever the other shares already name is not offered here. One person
                               holding two shares of a rule is one total typed twice - the save
                               refuses it, and a menu that offers what its own save rejects is the
                               worse of the two ways to say so. */
                            options={employeeOptions.filter((option) => (
                              option.value === String(target.employeeId)
                              || !rule.targets.some((other, i) => i !== targetIndex && String(other.employeeId) === option.value)
                            ))}
                          />
                        </div>
                        {rule.targets.length > 1 && (
                          <div className="flex shrink-0 items-center gap-1">
                            <TextField
                              label=""
                              className="w-14 [&>span]:hidden [&>*]:mt-0"
                              aria-label={`Percent for employee ${targetIndex + 1} of rule ${index + 1}`}
                              type="number"
                              min="1"
                              max="100"
                              value={target.percent}
                              disabled={disabled}
                              onChange={(event) => updateTarget(index, targetIndex, { percent: event.target.value })}
                            />
                            <span className="text-xs text-slate-500">%</span>
                            <IconButton
                              size="xs"
                              ariaLabel={`Remove employee ${targetIndex + 1} from rule ${index + 1}`}
                              disabled={disabled}
                              onClick={() => setTargets(index, rule.targets.filter((_, i) => i !== targetIndex))}
                            >
                              <DeleteOutlineRoundedIcon fontSize="inherit" />
                            </IconButton>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* What is outstanding, and the controls that act on the rule as a whole - below
                    the shares, where they cannot be read as belonging to one of them. */}
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <p className={`text-[11px] ${issue ? "text-rose-600" : "text-slate-500"}`}>
                    {issue || (index === 0 ? "Checked first" : `Checked after ${index} rule${index === 1 ? "" : "s"} above`)}
                  </p>
                  <div className="flex shrink-0 items-center gap-1">
                    <IconButton
                      size="xs"
                      ariaLabel={`Move rule ${index + 1} up`}
                      disabled={disabled || index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUpwardRoundedIcon fontSize="inherit" />
                    </IconButton>
                    <IconButton
                      size="xs"
                      ariaLabel={`Move rule ${index + 1} down`}
                      disabled={disabled || index === rules.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDownwardRoundedIcon fontSize="inherit" />
                    </IconButton>
                    <IconButton
                      size="xs"
                      ariaLabel={`Remove rule ${index + 1}`}
                      disabled={disabled}
                      onClick={() => onChange(rules.filter((_, position) => position !== index))}
                    >
                      <DeleteOutlineRoundedIcon fontSize="inherit" />
                    </IconButton>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="mt-3 rounded-lg border border-dashed border-slate-200 bg-white px-3 py-4 text-[11px] text-slate-500 sm:text-xs">
          No rules yet — imported {nounPlural} arrive unassigned and have to be given an owner by hand.
        </p>
      )}
    </div>
  );
}
