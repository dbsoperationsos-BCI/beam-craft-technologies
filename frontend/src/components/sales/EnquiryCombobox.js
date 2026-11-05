"use client";

import { useId, useRef, useState } from "react";
import useMenuDismiss from "@/components/shared/useMenuDismiss";

/**
 * An Enquiry ID picker: type to filter the CRM's leads, then pick one. Typing alone settles nothing.
 *
 * The rows come from the CRM's leads (via `searchSalesEnquiries`), so each one shows the client's
 * name and number under the id - the two things that tell near-identical enquiry ids apart. It
 * lived inline in CreateProjectFormPanel until the W/A Group-Name Generator needed the same
 * control; it is one component so the two pickers cannot drift apart.
 *
 * What is typed used to *be* the answer: every keystroke was written straight to the field, so a
 * project could be booked against an enquiry that exists nowhere in the CRM - a typo in the id was
 * enough, and nothing on screen said so. The box now holds its own text while the list is open and
 * hands it out only to filter; the value changes when a row is chosen and at no other time. On the
 * way out the box goes back to reading whatever is actually selected, so a half-typed search is
 * never left looking like an answer.
 *
 * `onSearch` is therefore what to *look for*, not what was chosen: a caller keeps it apart from the
 * field the form saves. `onSelect` is the only thing that settles a value.
 *
 * `readOnly` is the picker on a project that already has an enquiry. Nothing about it is a control
 * then - there is no list to open and nothing to search - so it is drawn as the value it is holding
 * rather than as a search box that quietly refuses to search. See the note above the return.
 *
 * The label reads "Enquiry ID" rather than "Select Enquiry ID". "Select" is an instruction, and it
 * was still being given on a form where the field cannot be selected at all; it was also the only
 * label on this screen that named its own control rather than its answer. The W/A Group-Name
 * Generator already passed this label by hand, so the two now agree without being told to.
 */
export default function EnquiryCombobox({ label = "Enquiry ID", required = false, readOnly = false, value, enquiries, loading, capped = false, total = 0, onSearch, onSelect }) {
  const [open, setOpen] = useState(false);
  // The text being typed, which exists only while the list is open. Closed, the box reads `value`.
  const [query, setQuery] = useState("");
  const rootRef = useRef(null);
  const listboxId = useId();

  function close() {
    setOpen(false);
    setQuery("");
  }
  useMenuDismiss([rootRef], close, open);

  function beginSearch() {
    if (open) return;
    // Opens on what is already chosen, so the list starts at the enquiry in hand rather than at
    // everything, and clearing the box is a deliberate act rather than the starting state.
    setQuery(value || "");
    onSearch(value || "");
    setOpen(true);
  }

  /*
   * Read-only, and drawn as a value rather than as a refused control.
   *
   * Not a `combobox` with `aria-expanded`, not `type="search"`, and with none of the handlers: a
   * screen reader announcing a combobox that never opens, and a search box with a clear × that
   * clears nothing, both describe a control this is not. It is the enquiry this project was booked
   * against, which is settled - a project points at one client's enquiry, and re-pointing it here
   * would silently move the booking to somebody else while every figure on the form stayed put.
   *
   * The grey fill is the same one `ClientPhoneField` above uses for a value the quotation settled,
   * so the two read alike on one form.
   */
  if (readOnly) {
    return <div className="block text-[11px] font-semibold text-slate-600 sm:text-xs">
      <span>{label}{required && <span aria-hidden="true" className="ml-0.5 text-rose-500">*</span>}</span>
      <input
        value={value || ""}
        readOnly
        aria-label={label}
        className="mt-1.5 block min-h-9 w-full cursor-default rounded-lg border border-slate-300 bg-slate-100 px-3 text-xs font-normal text-slate-600 outline-none sm:text-sm"
      />
      <p className="mt-1.5 font-normal text-slate-500">The enquiry this project was booked against, and it cannot be changed here.</p>
    </div>;
  }

  return <div ref={rootRef} className="relative block text-[11px] font-semibold text-slate-600 sm:text-xs">
    <span>{label}{required && <span aria-hidden="true" className="ml-0.5 text-rose-500">*</span>}</span>
    <input
      type="search"
      role="combobox"
      aria-expanded={open}
      aria-controls={listboxId}
      aria-haspopup="listbox"
      aria-autocomplete="list"
      value={open ? query : (value || "")}
      onFocus={beginSearch}
      onClick={beginSearch}
      onKeyDown={(event) => {
        // Enter closes the list without choosing anything: there is nothing to commit by typing,
        // and in a form a bare Enter would otherwise submit.
        if (event.key === "Enter") { event.preventDefault(); close(); }
      }}
      onChange={(event) => {
        const next = event.target.value;
        setQuery(next);
        onSearch(next);
        setOpen(true);
      }}
      placeholder="Search enquiry ID, client name or number"
      className="mt-1.5 block min-h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs font-normal text-slate-700 outline-none transition sm:text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
    />
    {open && <div className="absolute z-[90] mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
      <div id={listboxId} className="max-h-64 overflow-y-auto py-1" role="listbox" aria-label={label}>
        {loading
          ? <p className="px-3 py-3 text-sm font-normal text-slate-500">Searching enquiries...</p>
          : enquiries.length
            ? enquiries.map((item) => <button
              key={`${item.enquiryId}-${item.clientMainNumber || ""}`}
              type="button"
              role="option"
              aria-selected={item.enquiryId === value}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => { onSelect(item); close(); }}
              className="block w-full border-b border-slate-100 px-3 py-2 text-left text-sm font-normal text-slate-700 hover:bg-blue-50"
            >
              <span className="block font-medium text-slate-900">{item.enquiryId}</span>
              <span className="mt-1 block text-xs text-slate-500">{[item.clientName, item.clientMainNumber, item.whatsappGroupName].filter(Boolean).join(" · ") || "CRM lead enquiry"}</span>
            </button>)
            : <p className="px-3 py-3 text-sm font-normal text-slate-500">No matching enquiries found. Enquiries come from the CRM&apos;s leads, and only a lead that exists there can be chosen.</p>}
      </div>
      {/* A list that stops at its page reads as a list that has lost entries - which is exactly how
          the old cap was experienced, when a text sort on the enquiry id meant whole verticals fell
          off the end. Said out loud instead, with the one thing that reaches the rest: typing. */}
      {!loading && capped && <p className="border-t border-slate-100 bg-slate-50 px-3 py-2 text-xs font-normal text-slate-500">
        Showing the {enquiries.length} most recent of {total}. Type to search the rest.
      </p>}
    </div>}
  </div>;
}
