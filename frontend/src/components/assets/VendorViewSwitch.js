"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Dropdown from "@/components/shared/Dropdown";

/*
 * The two things the Vendors screen can be showing: the **register**, and the **payments** the
 * studio owes its vendors.
 *
 * One control shared by both views rather than one written into each header, so the two cannot drift
 * apart and switching back lands exactly where switching away left. It sits beside the heading
 * because it says what the page *is*, not what to do to it - the filters and the buttons are the
 * reader's tools, and this is the page's own name.
 *
 * `?view=payments` in the URL, so a link holds the view it was shared on. Drawn at all only where
 * `canSeePayments` - `ACCOUNTS / Payment Request` - because a reader who holds Vendor
 * Management alone has nothing to switch to.
 */
export const VENDOR_VIEWS = { register: "Vendors", payments: "Vendor Payments" };

export default function VendorViewSwitch({ view, canSeePayments }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  if (!canSeePayments) return null;
  function choose(next) {
    const query = new URLSearchParams(params.toString());
    if (next === "payments") query.set("view", "payments");
    else query.delete("view");
    // The other view's filters mean nothing here, so they are not carried across.
    for (const key of ["vendor", "status"]) query.delete(key);
    const text = query.toString();
    router.replace(text ? `${pathname}?${text}` : pathname);
  }
  return <div className="min-w-0 border-l border-slate-200 pl-3">
    <Dropdown
      mode="menu"
      ariaLabel="Vendors view"
      value={view}
      onChange={choose}
      options={Object.entries(VENDOR_VIEWS).map(([value, label]) => ({ value, label }))}
      sorted={false}
    />
  </div>;
}
