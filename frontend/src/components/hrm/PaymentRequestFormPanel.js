"use client";

import { useCallback, useMemo, useState } from "react";
import SchemaFormPanel from "@/components/schema-form/SchemaFormPanel";
import Button from "@/components/shared/Button";
import useFormErrors from "@/components/shared/useFormErrors";
import { createPaymentRequest, updatePaymentRequest } from "@/services/hrm/payment-requests.service";
import {
  MAX_REPAYMENT_MONTHS,
  REPAYMENT_OVER_MONTHS,
  TYPES_WITH_COMPUTED_TOTAL,
  SETTLEMENT_EXCESS,
  TYPES_WITH_DESCRIPTION,
  TYPES_WITH_EXPENSES,
  emptyExpenseLine,
  labelForType,
  requestFormSections,
  requestLeadFields,
  requestInitialValues,
  requestTypeChoices,
  expenseLineWording,
} from "@/constants/paymentRequestConfig";
import PaymentRequestExpenseLines from "./PaymentRequestExpenseLines";
import { vendorLabel } from "@/lib/vendorLabel.mjs";
import useRemoteOptions from "@/components/shared/useRemoteOptions";
import { searchPaymentRequestVendors } from "@/services/hrm/payment-requests.service";

function errorMessage(error, fallback) {
  if (error?.status === 401 || error?.status === 403) return "Your session has expired. Please sign in again.";
  return error?.data?.message || error?.message || fallback;
}

/**
 * Raises one of the four payment requests.
 *
 * The kind is chosen before the fields, the way Add Asset asks single or bulk and Add Entry asks
 * the direction: the answer decides what the form is — whether it itemises expenses, whether it
 * asks for a vendor, whether the amount is stated or totalled — and a request cannot change kind
 * once raised. So it is the panel's first step, with the way back to it at the top of the fields.
 *
 * What each kind asks for lives in the field list rather than here; this owns the kind, the expense
 * lines, validation and saving.
 */
/**
 * A stored request read back into the shape the form holds.
 *
 * The vendor is matched by name because the request stores `vendorName`, not an id — the name is
 * kept so the record survives the vendor being removed. A vendor since renamed or deleted matches
 * nothing, and the picker starts empty rather than pointing at the wrong one; validation then asks
 * for it before the edit can be saved.
 */
function formValuesFrom(request, options) {
  if (!request) return { ...requestInitialValues };
  const vendor = request.vendorName ? (options.vendors || []).find((candidate) => candidate.vendorName === request.vendorName) : null;
  return {
    ...requestInitialValues,
    vendorId: vendor ? String(vendor.id) : "",
    branch: request.branch || "",
    type: request.type || "",
    amount: request.amount === null || request.amount === undefined ? "" : String(request.amount),
    reason: request.reason || "",
    comments: request.comments || "",
    repaymentPlan: request.repaymentPlan || "",
    repaymentMonths: request.repaymentMonths === null || request.repaymentMonths === undefined ? "" : String(request.repaymentMonths),
    settlement: request.settlement || "",
    // The bare links, which is what the form holds and what the server reads back as already stored.
    qrCode: request.qrCodeUrls || [],
    bills: request.billUrls || [],
    // Agreed to when it was raised. An edit is a correction to that request, not a new one, so the
    // terms are not put again.
  };
}

function expenseLinesFrom(request) {
  const lines = (request?.expenses || []).map((line) => ({
    shootId: line.shootId || "",
    // The API sends a full timestamp; the date input holds a day.
    expenseDate: line.expenseDate ? String(line.expenseDate).slice(0, 10) : "",
    expenseType: line.expenseType || "",
    description: line.description || "",
    amount: line.amount === null || line.amount === undefined ? "" : String(line.amount),
  }));
  return lines.length ? lines : [{ ...emptyExpenseLine }];
}

/*
 * `fixedType` raises one kind and asks nothing about it: the form opens on that kind and the "what
 * are you asking for" choice is not drawn at all.
 *
 * It is for a screen that is already about that kind - Asset Management → Vendors raises a vendor's
 * bill and nothing else, so offering a salary advance there would be a question with one sensible
 * answer and three wrong ones. Every other screen leaves it out and gets the choice as before. The
 * server is unchanged: it reads the type from the payload and guards the same permission whichever
 * screen sent it.
 */
export default function PaymentRequestFormPanel({ request = null, fixedType = "", options, onClose, onSaved }) {
  // Editing a request that has already been raised, rather than raising a new one. The server
  // allows it only while the request is PENDING, and the row menu only offers it then.
  const editing = Boolean(request);
  const [type, setType] = useState(request?.type || fixedType || "");
  const [form, setForm] = useState(() => formValuesFrom(request, options));
  const [lines, setLines] = useState(() => expenseLinesFrom(request));
  const fields = useFormErrors();
  const { clear: clearField, clearAll: clearFields } = fields;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const itemises = TYPES_WITH_EXPENSES.includes(type);
  const computesTotal = TYPES_WITH_COMPUTED_TOTAL.includes(type);

  /**
   * Choosing a kind starts its form clean: the kinds share field names but not their meanings, so a
   * reason typed for a salary advance must not survive into an expense submission. The field's own
   * `clears` empties the shared answers; the lines are reset here because they are not a field.
   */
  const update = useCallback((field, value) => {
    // `requestCode` carries a prefix per kind, so changing the kind would leave the code describing
    // something the request is not. The server refuses it too.
    if (field === "type" && editing) return;
    setForm((current) => ({ ...current, [field]: value }));
    clearField(field);
    if (field === "type") {
      setType(value);
      setLines([{ ...emptyExpenseLine }]);
      clearFields();
      setError("");
    }
  }, [clearField, clearFields, editing]);

  const changeLines = useCallback((next) => {
    setLines(next);
    clearField("expenses");
  }, [clearField]);

  /*
   * What the expense boxes are called. Money already spent, money wanted before it is spent and
   * unspent money being handed back are three different questions, and an excess is not asked what
   * it was spent on at all. Which settlement means the money comes back is a flag on the studio's
   * own list, so it is read off the options rather than compared against the words here.
   */
  const wording = useMemo(
    () => expenseLineWording({ type, settlement: form.settlement, excessSettlement: options.excessSettlement }),
    [form.settlement, options.excessSettlement, type],
  );
  /*
   * Whether this submission is the studio's money coming **back** rather than money owed out. The
   * same test the QR-code field makes, and from the same place: which settlement means an excess is
   * the studio's own answer (`options.excessSettlement`), with the shipped name as the fallback for a
   * form opened before the lists have loaded.
   *
   * A submission with no settlement chosen yet is not an excess, so the date follows the shoot; the
   * moment somebody picks Excess it stops, and whatever they typed stays theirs.
   */
  const isExcess = form.settlement === (options.excessSettlement || SETTLEMENT_EXCESS);

  const remoteVendors = useRemoteOptions(searchPaymentRequestVendors, { read: (data) => data.vendors });

  const context = useMemo(() => ({
    expenseLines: <PaymentRequestExpenseLines
      lines={lines}
      onChange={changeLines}
      options={options}
      errors={fields.errors}
      showTotal={computesTotal}
      wording={wording}
      /*
       * Picking the shoot fills the line's date in: the two sat next to each other and were typed one
       * after the other off the same row. It stays editable, and a date somebody typed is never
       * rewritten.
       *
       * On the two kinds where the shoot's day **is** the answer: a vendor's bill is for a shoot, and
       * a reimbursement is money already spent on one. Not on an advance against expenses, which is
       * dated when the money is **needed** rather than when anything happened, and not on an expense
       * **excess**, which is unspent advance money being handed back - there is nothing it was spent
       * on, which is why that one is not even asked an expense type.
       */
      datesFollowShoot={type === "VENDOR_PAYMENT" || (type === "EXPENSE_SUBMISSION" && !isExcess)}
      disabled={saving}
    />,
    /*
     * The vendor register is searched on the server: `options.vendors` is a page for the picker to
     * open on, and typing reaches all of it. Labelled here rather than in `paymentRequestConfig`,
     * which imports nothing so that Node can load it in tests - and `optionsFor` keeps the chosen
     * vendor in the list when a later search no longer offers them, since the field holds an id and
     * without it the choice reads as blank while still saving correctly.
     */
    options: {
      vendors: remoteVendors
        .optionsFor(options.vendors || [], [form.vendorId], vendorLabel)
        .map((option) => ({ ...option, value: String(option.value) })),
    },
    remote: { vendors: remoteVendors },
  }), [changeLines, computesTotal, fields.errors, form.vendorId, isExcess, lines, options, remoteVendors, saving, type, wording]);

  /**
   * Mirrors the server contract in payment-requests/controller.js. The amount is only checked for
   * the kinds that state one — an expense submission is worth the sum of its lines, which the server
   * works out, so a figure typed here could only disagree with it.
   */
  function validate() {
    const next = {};
    if (!computesTotal && !(Number(form.amount) > 0)) next.amount = "Enter an amount greater than zero.";
    if (type === "SALARY_ADVANCE") {
      if (!form.reason.trim()) next.reason = "Enter the reason for the salary request.";
      if (!form.repaymentPlan) next.repaymentPlan = "Choose how the advance will be repaid.";
      if (form.repaymentPlan === REPAYMENT_OVER_MONTHS && !(Number(form.repaymentMonths) > 0)) {
        next.repaymentMonths = `Enter how many months, up to ${MAX_REPAYMENT_MONTHS}.`;
      }
    }
    if (type === "EXPENSE_SUBMISSION" && !form.settlement) next.settlement = "Choose whether this is an excess or a reimbursement.";
    if (type === "VENDOR_PAYMENT" && !form.vendorId) next.vendorId = "Choose the vendor.";
    // The three that describe themselves in prose. A salary advance states a reason instead, above.
    if (TYPES_WITH_DESCRIPTION.includes(type) && !form.comments.trim()) {
      next.comments = "Enter a description of what this is for.";
    }
    if (itemises) {
      if (!lines.length) next.expenses = "Add at least one expense line.";
      lines.forEach((line, index) => {
        if (!line.expenseDate) next[`expenseDate-${index}`] = "Required.";
        // Not asked of an excess, which has nothing it was spent on, so not required of it either.
        if (wording.asksExpenseType && !line.expenseType) next[`expenseType-${index}`] = "Required.";
        if (!(Number(line.amount) > 0)) next[`amount-${index}`] = "Required.";
      });
    }
    return next;
  }

  async function submit(event) {
    event.preventDefault();
    setError("");

    // Each problem under its own box; the top says only how many.
    if (!fields.check(validate())) return;

    setSaving(true);
    try {
      const payload = {
        type,
        reason: form.reason.trim() || null,
        comments: form.comments.trim() || null,
        repaymentPlan: form.repaymentPlan || null,
        repaymentMonths: form.repaymentPlan === REPAYMENT_OVER_MONTHS && form.repaymentMonths ? Number(form.repaymentMonths) : null,
        settlement: form.settlement || null,
        vendorId: form.vendorId ? Number(form.vendorId) : null,
        qrCode: form.qrCode,
        bills: form.bills,
        ...(computesTotal ? {} : { amount: Number(form.amount) }),
        expenses: itemises ? lines.map((line) => ({
          shootId: line.shootId || null,
          expenseDate: line.expenseDate,
          expenseType: wording.asksExpenseType ? line.expenseType : null,
          description: line.description.trim() || null,
          amount: Number(line.amount),
        })) : [],
      };
      const saved = editing ? await updatePaymentRequest(request.id, payload) : await createPaymentRequest(payload);
      const code = saved?.data?.requestCode || request?.requestCode || "";
      onSaved(`Request ${code} ${editing ? "updated" : "raised"}.`.replace("  ", " "));
    } catch (requestError) {
      if (!fields.fromServer(requestError)) setError(errorMessage(requestError, `Unable to ${editing ? "update" : "raise"} this request.`));
    } finally {
      setSaving(false);
    }
  }

  return <SchemaFormPanel
    title={editing ? `Edit ${labelForType(type)}` : type ? `Raise ${labelForType(type)}` : "Add Request"}
    description={type
      ? (requestTypeChoices.find((choice) => choice.value === type) || {}).description
      : "Choose what you are asking the studio for."}
    sections={requestFormSections}
    // Nothing to choose when the screen has already chosen, so the row of kinds is not drawn.
    leadFields={fixedType && !editing ? [] : requestLeadFields}
    values={{ ...form, type }}
    onChange={update}
    errors={fields.errors}
    context={context}
    sidebarAriaLabel="Payment request form sections"
    closeAriaLabel="Close payment request form"
    onClose={onClose}
    onSubmit={submit}
    error={error || fields.summary}
    saving={saving}
    submitLabel={editing ? "Update Request" : "Raise Request"}
    savingLabel={editing ? "Updating..." : "Raising..."}
  />;
}
