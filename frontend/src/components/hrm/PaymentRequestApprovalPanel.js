"use client";

import { useCallback, useMemo, useState } from "react";
import SchemaFormPanel from "@/components/schema-form/SchemaFormPanel";
import PaymentRequestExpenseSummary from "./PaymentRequestExpenseSummary";
import { approvePaymentRequest } from "@/services/hrm/payment-requests.service";
import { MODES_WITH_ACCOUNT, MODES_WITH_TRANSACTION_ID, OTHER_HANDLER, OTHER_PAYMENT_MODE, PAYMENT_MODES } from "@/constants/accountsConfig";
import { approvalFormSections } from "@/constants/paymentRequestConfig";

const today = () => new Date().toISOString().slice(0, 10);
const formatAmount = (value) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(value || 0);

function errorMessage(error, fallback) {
  if (error?.status === 403) return "Only an admin can decide a payment request.";
  return error?.data?.message || error?.message || fallback;
}

/**
 * Approving a request, which pays it.
 *
 * The request already says who is owed what and why. What it cannot know is how the money will
 * actually move, so this asks for that and the server writes the cash entry from both halves. The
 * fields are the cash entry's own, because that is what they become — including the direction: an
 * expense submission that came in under its advance is money returning, so it asks which account
 * the money went into rather than which it was paid from.
 */
export default function PaymentRequestApprovalPanel({ request, options, onClose, onDecided }) {
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

  const update = useCallback((field, value) => setForm((current) => ({ ...current, [field]: value })), []);

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
        })),
        { value: OTHER_HANDLER, label: "Other" },
      ],
    },
  }), [options, received, request]);

  function validate() {
    if (!form.entryDate) return "Enter the date the money moved.";
    if (!form.paymentMode) return "Choose the payment mode.";
    if (form.paymentMode === OTHER_PAYMENT_MODE && !form.paymentModeOther.trim()) return "Say what the payment mode was.";
    if (MODES_WITH_TRANSACTION_ID.includes(form.paymentMode) && !form.transactionId.trim()) {
      return form.paymentMode === "UPI" ? "Enter the UPI transaction ID." : `Enter the ${form.paymentMode} reference number.`;
    }
    if (MODES_WITH_ACCOUNT.includes(form.paymentMode)) {
      if (received && !form.receivedAccount.trim()) return "Enter the account the money went into.";
      if (!received && !form.paidFromAccount.trim()) return "Enter the account the money was paid from.";
    }
    if (!received && !form.paidTo.trim()) return "Enter who the payment went to.";
    if (!form.handler) return `Choose who ${received ? "received the money" : "paid the money out"}.`;
    if (form.handler === OTHER_HANDLER && !form.handlerOtherName.trim()) return `Enter who ${received ? "received the money" : "paid the money out"}.`;
    return "";
  }

  async function submit(event) {
    event.preventDefault();
    setError("");

    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }

    setSaving(true);
    try {
      const isOther = form.handler === OTHER_HANDLER;
      const saved = await approvePaymentRequest(request.id, {
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
      onDecided(`${request.requestCode} approved — ${saved?.data?.cashEntryCode || "entry"} recorded.`);
    } catch (requestError) {
      setError(errorMessage(requestError, "Unable to approve this request."));
    } finally {
      setSaving(false);
    }
  }

  return <SchemaFormPanel
    title={`Approve ${request.requestCode}`}
    description={`Approving records the ${received ? "money coming back in" : "payment"} in the Accounts Manager.`}
    sections={approvalFormSections}
    values={form}
    onChange={update}
    context={context}
    sidebarAriaLabel="Approval form sections"
    closeAriaLabel="Close approval form"
    onClose={onClose}
    onSubmit={submit}
    error={error}
    saving={saving}
    submitLabel="Approve & Record"
    savingLabel="Approving..."
  />;
}
