"use client";

import { useCallback, useMemo, useState } from "react";
import SchemaFormPanel from "@/components/schema-form/SchemaFormPanel";
import Button from "@/components/shared/Button";
import { createPaymentRequest, updatePaymentRequest } from "@/services/hrm/payment-requests.service";
import {
  MAX_REPAYMENT_MONTHS,
  REPAYMENT_OVER_MONTHS,
  TYPES_WITH_COMPUTED_TOTAL,
  TYPES_WITH_DESCRIPTION,
  TYPES_WITH_EXPENSES,
  emptyExpenseLine,
  labelForType,
  requestFormSections,
  requestLeadFields,
  requestInitialValues,
  requestTypeChoices,
} from "@/constants/paymentRequestConfig";
import PaymentRequestExpenseLines from "./PaymentRequestExpenseLines";

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
    acceptTerms: true,
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

export default function PaymentRequestFormPanel({ request = null, options, onClose, onSaved }) {
  // Editing a request that has already been raised, rather than raising a new one. The server
  // allows it only while the request is PENDING, and the row menu only offers it then.
  const editing = Boolean(request);
  const [type, setType] = useState(request?.type || "");
  const [form, setForm] = useState(() => formValuesFrom(request, options));
  const [lines, setLines] = useState(() => expenseLinesFrom(request));
  const [errors, setErrors] = useState({});
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
    setErrors((current) => (current[field] ? { ...current, [field]: "" } : current));
    if (field === "type") {
      setType(value);
      setLines([{ ...emptyExpenseLine }]);
      setErrors({});
      setError("");
    }
  }, [editing]);

  const changeLines = useCallback((next) => {
    setLines(next);
    setErrors((current) => (current.expenses ? { ...current, expenses: "" } : current));
  }, []);

  const context = useMemo(() => ({
    expenseLines: <PaymentRequestExpenseLines
      lines={lines}
      onChange={changeLines}
      options={options}
      errors={errors}
      showTotal={computesTotal}
      totalLabel={type === "ADVANCE_EXPENSE" ? "Estimated Advance Total" : "Total Expenses Submitted"}
      disabled={saving}
    />,
    options: { vendors: (options.vendors || []).map((vendor) => ({ value: String(vendor.id), label: `${vendor.vendorName}${vendor.vendorId ? ` · ${vendor.vendorId}` : ""}` })) },
  }), [changeLines, computesTotal, errors, lines, options, saving, type]);

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
        if (!line.expenseType) next[`expenseType-${index}`] = "Required.";
        if (!(Number(line.amount) > 0)) next[`amount-${index}`] = "Required.";
      });
    }
    if (!form.acceptTerms) next.acceptTerms = "Agree to the terms and conditions to raise this request.";
    return next;
  }

  async function submit(event) {
    event.preventDefault();
    setError("");

    const problems = validate();
    setErrors(problems);
    if (Object.values(problems).some(Boolean)) {
      setError(problems.expenses || Object.values(problems).find(Boolean));
      return;
    }

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
        acceptTerms: true,
        ...(computesTotal ? {} : { amount: Number(form.amount) }),
        expenses: itemises ? lines.map((line) => ({
          shootId: line.shootId || null,
          expenseDate: line.expenseDate,
          expenseType: line.expenseType,
          description: line.description.trim() || null,
          amount: Number(line.amount),
        })) : [],
      };
      const saved = editing ? await updatePaymentRequest(request.id, payload) : await createPaymentRequest(payload);
      const code = saved?.data?.requestCode || request?.requestCode || "";
      onSaved(`Request ${code} ${editing ? "updated" : "raised"}.`.replace("  ", " "));
    } catch (requestError) {
      setError(errorMessage(requestError, `Unable to ${editing ? "update" : "raise"} this request.`));
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
    leadFields={requestLeadFields}
    values={{ ...form, type }}
    onChange={update}
    errors={errors}
    context={context}
    sidebarAriaLabel="Payment request form sections"
    closeAriaLabel="Close payment request form"
    onClose={onClose}
    onSubmit={submit}
    error={error}
    saving={saving}
    submitLabel={editing ? "Update Request" : "Raise Request"}
    savingLabel={editing ? "Updating..." : "Raising..."}
  />;
}
