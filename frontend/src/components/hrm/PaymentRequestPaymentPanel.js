"use client";

import { avatarOf } from "@/lib/employeeAvatar.mjs";
import { useCallback, useMemo, useState } from "react";
import SchemaFormPanel from "@/components/schema-form/SchemaFormPanel";
import useFormErrors from "@/components/shared/useFormErrors";
import PaymentRequestExpenseSummary from "./PaymentRequestExpenseSummary";
import { payPaymentRequest } from "@/services/hrm/payment-requests.service";
import { MODES_WITH_ACCOUNT, MODES_WITH_TRANSACTION_ID, OTHER_HANDLER, OTHER_PAYMENT_MODE, PAYMENT_MODES } from "@/constants/accountsConfig";
import { paymentFormSections } from "@/constants/paymentRequestConfig";
import { isBlankText } from "@/lib/formErrors.mjs";

const today = () => new Date().toISOString().slice(0, 10);
const formatAmount = (value) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(value || 0);

function errorMessage(error, fallback) {
  if (error?.status === 403) return "Releasing money needs write access to Cash Management.";
  return error?.data?.message || error?.message || fallback;
}

/**
 * Releasing the money an approved request asked for — Accounts Manager → Pending → Record Payment.
 *
 * The request already says who is owed what and why, and the approval has said yes. What neither
 * knows is how the money actually moved, so this asks for that and the server writes the cash
 * entries from both halves. The fields are the cash entry's own, because that is what they become —
 * including the direction: an expense submission that came in under its advance is money returning,
 * so it asks which account the money went into rather than which it was paid from.
 *
 * This was the approval form, back when approving a request also paid it. Approving is a decision on
 * the Payment Requests screen now, and this is the second half, held by whoever keeps the cash book.
 */
export default function PaymentRequestPaymentPanel({ request, options, onClose, onPaid }) {
  const received = request.direction === "Received";
  const [form, setForm] = useState(() => ({
    entryDate: today(),
    paymentMode: "",
    paymentModeOther: "",
    transactionId: "",
    receivedAccount: "",
    paidFromAccount: "",
    // Pre-filled with what the server would derive, so the common case needs no typing.
    paidTo: request.type === "VENDOR_PAYMENT" ? (request.vendorName || "") : (request.requestedByName || ""),
    handler: "",
    handlerOtherName: "",
    paymentProof: [],
    remarks: "",
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const fields = useFormErrors();
  const clearField = fields.clear;

  const update = useCallback((field, value) => {
    clearField(field);
    setForm((current) => ({ ...current, [field]: value }));
  }, [clearField]);

  const context = useMemo(() => ({
    expenseBreakdown: <PaymentRequestExpenseSummary expenses={request.expenses} />,
    received,
    otherHandler: OTHER_HANDLER,
    modesWithTransactionId: MODES_WITH_TRANSACTION_ID,
    modesWithAccount: MODES_WITH_ACCOUNT,
    request: { ...request, amountText: formatAmount(request.amount) },
    options: {
      paymentModes: PAYMENT_MODES,
      accounts: options.accounts || [],
      handlers: [
        ...(options.employees || []).map((employee) => ({
          value: String(employee.id),
          label: `${employee.employeeName}${employee.employeeId ? ` · ${employee.employeeId}` : ""}`,
          avatar: avatarOf(employee),
        })),
        { value: OTHER_HANDLER, label: "Other" },
      ],
    },
  }), [options, received, request]);

  // Each problem under its own box, in the words the panel's generic "Required" gives way to.
  const paymentProblems = () => {
    const withAccount = MODES_WITH_ACCOUNT.includes(form.paymentMode);
    const handlerMissing = `${isBlankText(form.handler) ? "Choose" : "Enter"} who ${received ? "received the money" : "paid the money out"}.`;
    return {
      entryDate: form.entryDate ? "" : "Enter the date the money moved.",
      paymentMode: form.paymentMode ? "" : "Choose the payment mode.",
      paymentModeOther: form.paymentMode === OTHER_PAYMENT_MODE && isBlankText(form.paymentModeOther) ? "Say what the payment mode was." : "",
      transactionId: MODES_WITH_TRANSACTION_ID.includes(form.paymentMode) && isBlankText(form.transactionId)
        ? (form.paymentMode === "UPI" ? "Enter the UPI transaction ID." : `Enter the ${form.paymentMode} reference number.`)
        : "",
      receivedAccount: withAccount && received && isBlankText(form.receivedAccount) ? "Enter the account the money went into." : "",
      paidFromAccount: withAccount && !received && isBlankText(form.paidFromAccount) ? "Enter the account the money was paid from." : "",
      paidTo: !received && isBlankText(form.paidTo) ? "Enter who the payment went to." : "",
      handler: form.handler ? "" : handlerMissing,
      handlerOtherName: form.handler === OTHER_HANDLER && isBlankText(form.handlerOtherName) ? handlerMissing : "",
    };
  };

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (!fields.check(paymentProblems())) return;

    setSaving(true);
    try {
      const isOther = form.handler === OTHER_HANDLER;
      const saved = await payPaymentRequest(request.id, {
        entryDate: form.entryDate,
        paymentMode: form.paymentMode,
        paymentModeOther: form.paymentMode === OTHER_PAYMENT_MODE ? form.paymentModeOther.trim() : null,
        transactionId: MODES_WITH_TRANSACTION_ID.includes(form.paymentMode) ? form.transactionId.trim() : null,
        receivedAccount: received && MODES_WITH_ACCOUNT.includes(form.paymentMode) ? form.receivedAccount.trim() : null,
        paidFromAccount: !received && MODES_WITH_ACCOUNT.includes(form.paymentMode) ? form.paidFromAccount.trim() : null,
        paidTo: received ? null : form.paidTo.trim(),
        handlerEmployeeId: isOther ? null : Number(form.handler),
        handlerName: isOther ? form.handlerOtherName.trim() : null,
        handlerIsOther: isOther,
        paymentProof: Array.isArray(form.paymentProof) ? form.paymentProof : [],
        remarks: form.remarks.trim() || null,
      });
      onPaid(`${request.requestCode} paid — ${saved?.data?.cashEntryCode || "entry"} recorded.`);
    } catch (requestError) {
      if (!fields.fromServer(requestError, { handlerEmployeeId: "handler", handlerName: "handlerOtherName" })) setError(errorMessage(requestError, "Unable to record this payment."));
    } finally {
      setSaving(false);
    }
  }

  return <SchemaFormPanel
    title={`Record Payment · ${request.requestCode}`}
    description={`This records the ${received ? "money coming back in" : "payment"} in the cash book${request.type === "SALARY_ADVANCE" ? " and puts the advance on the payslip that takes it back" : ""}.`}
    sections={paymentFormSections}
    values={form}
    onChange={update}
    context={context}
    sidebarAriaLabel="Payment form sections"
    closeAriaLabel="Close payment form"
    onClose={onClose}
    onSubmit={submit}
    errors={fields.errors}
    error={error || fields.summary}
    saving={saving}
    submitLabel="Record Payment"
    savingLabel="Recording..."
  />;
}
