"use client";

import { useCallback, useState } from "react";
import { useModuleAccess } from "@/components/auth/PermissionsProvider";
import { getCashEntryOptions } from "@/services/accounts/cash-entries.service";
import { getScheduledPayment } from "@/services/accounts/scheduled-payments.service";

/**
 * **Receive** on a Shedule Payment row: Accounts' own scheduled payment panel (`ScheduledPaymentPanel`,
 * the one Projects → Payments and Accounts Manager open), so a payment is recorded the one way every
 * other screen records it - Full or Partial, the mode, transaction ID and proof - and Received and the
 * Balance Amount follow from that cash entry.
 *
 * Offered only to somebody who may write Accounts' cash (`ACCOUNTS / Cash Management`, what the panel's
 * routes ask); `canReceive` is false for everybody else and the button is absent.
 *
 * `isDirty()` says whether the schedule on screen has changes not yet saved: recording against it
 * then would leave the form saving a schedule that no longer matches the books (a part payment adds a
 * payment the form does not have), so it asks for Update Project first and opens nothing.
 * `onRecorded(message)` runs after every change the panel makes - the form reads the schedule again.
 */
export default function useScheduleReceiver({ isDirty = () => false, onRecorded, onError }) {
  const { canWrite: canReceive } = useModuleAccess("ACCOUNTS", "Cash Management");
  const [cashOptions, setCashOptions] = useState(null);
  const [payment, setPayment] = useState(null);
  const [openingId, setOpeningId] = useState("");

  const open = useCallback(async (row) => {
    if (isDirty()) {
      onError?.("Update Project first to save the changes to Shedule Payment, then receive the payment.");
      return;
    }
    setOpeningId(row.id);
    try {
      const [options, response] = await Promise.all([
        cashOptions ? Promise.resolve({ data: cashOptions }) : getCashEntryOptions(),
        getScheduledPayment(row.id),
      ]);
      setCashOptions(options?.data || {});
      if (!response?.data) throw new Error("That payment could not be found.");
      setPayment(response.data);
    } catch (openError) {
      onError?.(openError.data?.message || openError.message || "Unable to open this payment.");
    } finally {
      setOpeningId("");
    }
  }, [cashOptions, isDirty, onError]);

  return {
    canReceive,
    open,
    openingId,
    // Spread onto `ScheduledPaymentPanel` (keyed by `payment.id`) while `payment` is set.
    payment,
    panelProps: payment ? {
      payment,
      recording: true,
      canWrite: canReceive,
      cashOptions: cashOptions || {},
      zIndexClassName: "z-[130]",
      onClose: () => setPayment(null),
      onChanged: (changed, message) => {
        if (changed) setPayment(changed);
        onRecorded?.(message);
      },
    } : null,
  };
}
