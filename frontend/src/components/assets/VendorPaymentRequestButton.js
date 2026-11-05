"use client";

import { useCallback, useEffect, useState } from "react";
import Button from "@/components/shared/Button";
import PaymentRequestFormPanel from "@/components/hrm/PaymentRequestFormPanel";
import { useModuleAccess } from "@/components/auth/PermissionsProvider";
import { getPaymentRequestOptions } from "@/services/hrm/payment-requests.service";

/*
 * **Add Request** on Asset Management → Vendors: raises a vendor's bill without leaving the screen
 * the vendors are on.
 *
 * It is the Payment Requests screen's own form (`PaymentRequestFormPanel`), opened on the Vendor
 * Payment kind and nothing else - `fixedType`, so the row of kinds is not drawn: this page is about
 * vendors, and offering a salary advance here would be a question with one sensible answer and
 * three wrong ones. The request itself is an ordinary one from the moment it is saved: it lands in
 * Payment Requests, it is decided there, and it shows up on this page's Vendor Payments view.
 *
 * `ACCOUNTS / Payment Request` **Read / Write**, which is what the POST behind it is
 * guarded by - absent for a reader who may only look, rather than drawn and then refused. Vendor
 * Management's own permission does not come into it: this asks the studio to pay money.
 *
 * The form's options - employees, projects, shoots, accounts, expense types - are fetched when the
 * panel is first opened rather than with the page, since most visits never raise a bill.
 */
const EMPTY = { employees: [], projects: [], shoots: [], accounts: [], expenseTypes: [], canDecide: false };

export default function VendorPaymentRequestButton({ onRaised }) {
  const { canWrite } = useModuleAccess("ACCOUNTS", "Payment Request");
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState(null);

  const load = useCallback(() => getPaymentRequestOptions()
    .then((result) => setOptions({ ...EMPTY, ...(result?.data || {}) }))
    // The panel still opens: its pickers are empty, and the server refuses what it cannot accept.
    .catch(() => setOptions(EMPTY)), []);

  useEffect(() => { if (open && !options) void load(); }, [load, open, options]);

  if (!canWrite) return null;
  return <>
    <Button type="button" onClick={() => setOpen(true)}>Add Request</Button>
    {open && options && <PaymentRequestFormPanel
      fixedType="VENDOR_PAYMENT"
      options={options}
      onClose={() => setOpen(false)}
      onSaved={(message) => { setOpen(false); onRaised?.(message); }}
    />}
  </>;
}
