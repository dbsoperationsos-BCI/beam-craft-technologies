"use client";

import { useCallback, useState } from "react";
import Button from "@/components/shared/Button";
import TextAreaField from "@/components/shared/TextAreaField";
import PaymentRequestExpenseSummary from "@/components/hrm/PaymentRequestExpenseSummary";
import useFormErrors from "@/components/shared/useFormErrors";
import Dialog from "@/components/ui/Dialog";
import PaymentRequestPaymentPanel from "@/components/hrm/PaymentRequestPaymentPanel";
import PaymentRequestFormPanel from "@/components/hrm/PaymentRequestFormPanel";
import { approvePaymentRequest, rejectPaymentRequest, withdrawPaymentRequest } from "@/services/hrm/payment-requests.service";

function errorMessage(error, fallback) {
  return error?.data?.message || error?.message || fallback;
}

/**
 * What can be done to a payment request, and the panels that do it — written once for the two
 * screens that offer them.
 *
 * A request now passes through two hands, and each screen holds one of them:
 *
 *   * **Payment Requests** — raise, correct, withdraw, and the decision. Approving says yes and
 *     writes nothing but the decision; the money has not moved.
 *   * **Accounts Manager → Pending** — the approved ones waiting to be released, and Record Payment,
 *     which writes the cash entries and puts a salary advance onto the payslip that recovers it.
 *
 * Both halves live here rather than one per screen because the rejection's required reason, the
 * withdraw confirm and the payment panel would otherwise drift apart, and the half that drifted
 * would be the half nobody tested. The caller supplies what differs:
 *
 *   * `canWrite` — Read / Write on `ACCOUNTS / Payment Request`: the permission to **raise**
 *     a request, which is also what lets somebody withdraw one of their own.
 *   * `canDecide` — Read / Write on `ACCOUNTS / Payment Request Approver` (`meta.canDecide` off the
 *     list): approve, reject, and **correct** anybody's request.
 *   * `myEmployeeId` — who is reading (`meta.myEmployeeId`), so Withdraw is offered on the rows this
 *     person raised and on no others.
 *
 *     **The two do not overlap, on purpose.** One permission used to do both, so whoever could
 *     approve could approve their own request - ask the studio for money and allow it in two clicks -
 *     and the row then named one person as who requested it and who decided it. So: a requester may
 *     view and withdraw their own; an approver may view, correct and decide anybody's, and may not
 *     withdraw. Withdrawing deletes the row, while rejecting records who decided and why, and an
 *     approver who disagrees with a request has the second and does not need the first.
 *
 *     A reader who may only look gets a menu with nothing in it but their own `view`.
 *   * `canPay` — Read / Write on `ACCOUNTS / Cash Management`, the cash book's own permission.
 *     Passed only by Accounts Manager: releasing money is that screen's job, and somebody who may
 *     approve a spend does not thereby get to pay it.
 *   * `view` — how that screen reads a record in full, which each one already has its own way of
 *     doing. Omitted, no View item is offered.
 *   * `onChanged` — reload the screen's own rows; what Accounts Manager reloads is not what the
 *     Payment Requests screen does.
 *   * `onGone` — a request that has just left the list, so a screen holding it open beside the table
 *     can let go of it.
 *
 * `items(request)` is the ⋮'s list for one row and `panels` is the JSX the screen renders once,
 * outside its table. `approve`, `reject` and `pay` are the same openers the ⋮ uses, for a screen
 * whose board decides a request by dragging it into a column instead.
 */
export default function usePaymentRequestActions({ options, canWrite, canDecide, myEmployeeId = null, canPay = false, onChanged, onGone, showSuccess, showError, view }) {
  const [editing, setEditing] = useState(null);
  const [approving, setApproving] = useState(null);
  const [approveRemarks, setApproveRemarks] = useState("");
  const [paying, setPaying] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [rejectRemarks, setRejectRemarks] = useState("");
  const [withdrawing, setWithdrawing] = useState(null);
  const [busy, setBusy] = useState(false);
  const rejectFields = useFormErrors();
  const clearRejectFields = rejectFields.clearAll;

  // Shuts whichever panel was open and lets the screen reload. Every panel answers through it, so a
  // saved edit and a recorded payment leave the screen in the same state.
  const afterChange = useCallback(async (message) => {
    setEditing(null);
    setPaying(null);
    if (message) showSuccess(message);
    await onChanged?.();
  }, [onChanged, showSuccess]);

  const approve = useCallback((request) => {
    setApproveRemarks("");
    setApproving(request);
  }, []);
  const pay = useCallback((request) => setPaying(request), []);
  const reject = useCallback((request) => {
    setRejectRemarks("");
    clearRejectFields();
    setRejecting(request);
  }, [clearRejectFields]);

  /*
   * Whether a row is the reader's own. Compared on the **employee** record, which is what a request
   * stores as its requester, not on the login id - one person can hold both and they are different
   * numbers, so comparing the wrong one offers Withdraw on somebody else's row or on none.
   */
  const mine = useCallback((request) => Boolean(myEmployeeId) && Number(request?.requestedById) === Number(myEmployeeId), [myEmployeeId]);

  const items = useCallback((request) => {
    const list = [];
    if (view) list.push({ label: "View", onSelect: () => view(request) });
    const pending = request.status === "PENDING";
    if (canDecide && pending) {
      list.push({ label: "Approve", onSelect: () => approve(request) });
      list.push({ label: "Reject", tone: "danger", onSelect: () => reject(request) });
    }
    /*
     * Releasing the money, offered only on an approved request that nothing has been paid against
     * yet. `paid` is the server's reading of the cash entries, not a status, so a request already
     * released never offers it again — the endpoint refuses it as well.
     */
    if (canPay && request.status === "APPROVED" && !request.paid) {
      list.push({ label: "Record Payment", onSelect: () => pay(request) });
    }
    // Correcting a mistake before anybody decides it, rather than withdrawing and raising again.
    // Correcting belongs to whoever decides: the figure an approver is reading should not change under
    // them, and a requester who got their own ask wrong withdraws it and raises the one they meant.
    if (canDecide && pending) list.push({ label: "Edit", onSelect: () => setEditing(request) });
    // Their own ask, taken back. Not offered on anybody else's row, whatever the reader holds.
    if (canWrite && pending && mine(request)) list.push({ label: "Withdraw", tone: "danger", onSelect: () => setWithdrawing(request) });
    // A menu that opens onto nothing says so, rather than opening onto an empty box.
    if (!list.length) list.push({ label: "No actions available", disabled: true, onSelect: () => {} });
    return list;
  }, [approve, canDecide, canPay, canWrite, mine, pay, reject, view]);

  async function confirmApprove() {
    setBusy(true);
    try {
      await approvePaymentRequest(approving.id, { remarks: approveRemarks.trim() || null });
      const code = approving.requestCode;
      // Said before the reload: the request leaves this screen's Pending tab for Accounts Manager's.
      onGone?.(approving);
      setApproving(null);
      await afterChange(`${code} approved. Accounts can release the money from Accounts Manager → Pending.`);
    } catch (requestError) {
      showError(errorMessage(requestError, "Unable to approve this request."));
    } finally {
      setBusy(false);
    }
  }

  async function confirmReject() {
    if (!rejectFields.check({ remarks: rejectRemarks.trim() ? "" : "Enter why this request is being turned down." })) return;
    setBusy(true);
    try {
      await rejectPaymentRequest(rejecting.id, rejectRemarks.trim());
      const code = rejecting.requestCode;
      setRejecting(null);
      await afterChange(`${code} rejected.`);
    } catch (requestError) {
      showError(errorMessage(requestError, "Unable to reject this request."));
    } finally {
      setBusy(false);
    }
  }

  async function confirmWithdraw() {
    setBusy(true);
    try {
      await withdrawPaymentRequest(withdrawing.id);
      const code = withdrawing.requestCode;
      // Said before the reload, so a screen reading it beside the table lets go of it first.
      onGone?.(withdrawing);
      setWithdrawing(null);
      await afterChange(`${code} withdrawn.`);
    } catch (requestError) {
      showError(errorMessage(requestError, "Unable to withdraw this request."));
    } finally {
      setBusy(false);
    }
  }

  const panels = <>
    {editing && <PaymentRequestFormPanel
      request={editing}
      options={options}
      onClose={() => setEditing(null)}
      onSaved={afterChange}
    />}

    {paying && <PaymentRequestPaymentPanel
      request={paying}
      options={options}
      onClose={() => setPaying(null)}
      onPaid={afterChange}
    />}

    {/*
      * Approving is a dialog rather than a form panel, because there is nothing left to fill in: the
      * request already says who is owed what, and how the money moves is asked when it moves. The
      * remark is optional and the dialog says what happens next, so nobody is left wondering why
      * approving did not produce a cash entry.
      */}
    {approving && <Dialog
      title={`Approve ${approving.requestCode}?`}
      description="This authorises the payment. The money is released separately, from Accounts Manager → Pending, by whoever keeps the cash book."
      busy={busy}
      onClose={() => setApproving(null)}
      onSubmit={(event) => { event.preventDefault(); void confirmApprove(); }}
      footer={<>
        <Button className="max-sm:flex-1" type="button" onClick={() => setApproving(null)} disabled={busy}>Cancel</Button>
        <Button className="max-sm:flex-1" variant="primary" disabled={busy}>{busy ? "Approving..." : "Approve Request"}</Button>
      </>}
    >
      {/*
        * **What is being authorised, in the dialog that authorises it.**
        *
        * This asked for a remark and nothing else: the approver saw a request code in the title and
        * had to go and open the record separately to find out which shoots the money was spread
        * across, what each line was for and what the lines actually said. Most did not, which makes
        * the remark the only evidence anybody looked - and "how can I approve without seeing it" is
        * exactly the question that found this.
        *
        * The same table the payment panel and the record view draw, so the three say the same thing.
        */}
      {Boolean(approving.expenses?.length) && <PaymentRequestExpenseSummary expenses={approving.expenses} />}
      <TextAreaField
        label="Remarks"
        helperText="Optional. Kept with the decision, and read by whoever releases the money."
        value={approveRemarks}
        onChange={(event) => setApproveRemarks(event.target.value)}
        rows={3}
        placeholder="e.g. Approved against the quote attached"
      />
    </Dialog>}

    {rejecting && <Dialog
      title={`Reject ${rejecting.requestCode}?`}
      description="The reason is sent back to whoever raised it, so say what would have to change."
      busy={busy}
      onClose={() => setRejecting(null)}
      onSubmit={(event) => { event.preventDefault(); void confirmReject(); }}
      footer={<>
        <Button className="max-sm:flex-1" type="button" onClick={() => setRejecting(null)} disabled={busy}>Cancel</Button>
        <Button className="max-sm:flex-1" variant="danger" disabled={busy}>{busy ? "Rejecting..." : "Reject Request"}</Button>
      </>}
    >
      {/* The same, because a rejection is written **about** these lines - "the bills do not add up to
          the amount claimed" cannot be checked against a dialog that does not show them. */}
      {Boolean(rejecting.expenses?.length) && <PaymentRequestExpenseSummary expenses={rejecting.expenses} />}
      <TextAreaField
        required
        label="Reason for Rejection"
        helperText="Sent back to whoever raised the request, so they know what to fix."
        value={rejectRemarks}
        onChange={(event) => { rejectFields.clear("remarks"); setRejectRemarks(event.target.value); }}
        error={rejectFields.errors.remarks}
        rows={4}
        placeholder="e.g. The bills attached do not add up to the amount claimed"
      />
    </Dialog>}

    {withdrawing && <Dialog
      title={`Withdraw ${withdrawing.requestCode}?`}
      description="It stops appearing for approval. Only a request nobody has decided yet can be withdrawn."
      busy={busy}
      onClose={() => setWithdrawing(null)}
      footer={<>
        <Button className="max-sm:flex-1" type="button" onClick={() => setWithdrawing(null)} disabled={busy}>Cancel</Button>
        <Button className="max-sm:flex-1" type="button" variant="danger" onClick={confirmWithdraw} disabled={busy}>{busy ? "Withdrawing..." : "Withdraw Request"}</Button>
      </>}
    />}
  </>;

  /*
   * A plain object, not a `useMemo`: `panels` is fresh JSX on every render whatever is done around
   * it, so memoising the wrapper only promises a stability it cannot keep. `items` is the one piece
   * a caller puts in a dependency array - the table memoises its columns on it - and that is a
   * `useCallback` above.
   */
  return { items, panels, busy, approve, reject, pay };
}
