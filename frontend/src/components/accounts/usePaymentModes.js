"use client";

import { useEffect, useMemo, useState } from "react";
import { getMasterData } from "@/services/hrm/master-data.service";
import { PAYMENT_MODES } from "@/constants/accountsConfig";

/**
 * The payment modes the studio maintains, and what each of them asks for.
 *
 * Settings → Field Settings → Accounts → Payment Mode keeps the list; each row says whether it
 * wants a reference, an account, or a line saying what the payment actually was. Read here so the
 * fields drawn, the check before saving and what is sent all read the same answer - and so does the
 * server, which asks the same list.
 *
 * Shared rather than written per screen. Two forms record money against a project - Accounts' Cash
 * Received and the **Payment Received** section of Create Project - and they are the same fields
 * from the same config. Create Project built its context by hand and simply left `paymentModes`
 * out, so its Payment Mode dropdown had nothing in it and the advance could not be filled in at
 * all. One hook is what stops a third screen doing the same.
 *
 * ── Never empty ──
 *
 * The dropdown having no options means no money can be recorded, so there are three answers in
 * order: the studio's own list, then whatever the accounts options endpoint sent with this form
 * (the same table, read on the server), then the list compiled into `accountsConfig`. The last is
 * what this offered before the list was editable.
 *
 * The three "what does this mode ask for" arrays are left empty when the read fails, which is
 * deliberate: `listed()` in `accountsConfig` falls back to its own compiled arrays for an empty
 * one, so the follow-up fields behave exactly as they did before this list existed.
 */
export default function usePaymentModes(fallbackModes) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    let live = true;
    void getMasterData("payment-modes", { active: true })
      .then((response) => { if (live) setRows(response?.data || null); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  return useMemo(() => ({
    paymentModes: rows?.length
      ? rows.map((row) => row.name)
      : (fallbackModes?.length ? fallbackModes : PAYMENT_MODES),
    modesWithTransactionId: (rows || []).filter((row) => row.asksForTransactionId).map((row) => row.name),
    modesWithAccount: (rows || []).filter((row) => row.asksForAccount).map((row) => row.name),
    modesWithDetails: (rows || []).filter((row) => row.asksForDetails).map((row) => row.name),
  }), [rows, fallbackModes]);
}
