"use client";

import { useEffect, useState } from "react";
import ComboBoxField from "@/components/shared/ComboBoxField";
import Button from "@/components/shared/Button";
import Dialog from "@/components/ui/Dialog";
import { getCrmLeadEnquiryIds } from "@/services/sales/crm-lead-ids.service";
import { VERTICALS } from "./quotationVerticalConfig";

/*
 * Copies one version into a quotation of its own.
 *
 * The same package quoted for a second client is the ordinary case: everything priced comes across.
 * The copy is a new quotation at version 1 with a link of its own, never a version of anything the
 * target enquiry already holds - only Edit adds a version.
 *
 * **Including the enquiry it already belongs to.** That was refused while an enquiry could hold
 * only one chain, because the copy could only have landed as the next version of its own; now it
 * is a second quotation for that enquiry, which is the Dum Dum package used as the start of the
 * Corp one. The dialog therefore offers every enquiry, its own included, and the sentence under
 * the field says which of the two things is about to happen.
 *
 * The dialog asks one question. The CRM lists its enquiry ids one vertical at a time, so all three
 * are fetched and offered together rather than making somebody name the vertical first - the person
 * duplicating knows which enquiry they mean, not which board it is filed under, and a quotation
 * copied across verticals is a real thing to want.
 */
export default function QuotationDuplicateDialog({ quotation, saving, onDuplicate, onClose }) {
  const [enquiryId, setEnquiryId] = useState("");
  const [enquiryIdOptions, setEnquiryIdOptions] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    // Whatever answers is offered. A vertical that fails leaves its ids out rather than emptying
    // the list, and the field still accepts a typed id either way.
    Promise.allSettled(VERTICALS.map((vertical) => getCrmLeadEnquiryIds(vertical))).then((results) => {
      if (!active) return;
      const ids = results.flatMap((result) => result.status === "fulfilled" && Array.isArray(result.value?.data) ? result.value.data : []);
      setEnquiryIdOptions([...new Set(ids)].sort((first, second) => String(first).localeCompare(String(second), undefined, { numeric: true })));
    });
    return () => { active = false; };
  }, []);

  // Whether the copy is about to land on the enquiry this quotation is already for, which is the
  // one thing the note under the field has to say differently.
  const sameEnquiry = enquiryId.trim() !== "" && enquiryId.trim() === (quotation?.enquiryId || "");

  function submit(event) {
    event.preventDefault();
    const target = enquiryId.trim();
    if (!target) return setError("Choose the enquiry to duplicate this quotation to.");
    setError("");
    onDuplicate?.(target);
  }

  return <Dialog
    title={`Duplicate ${quotation?.quotationId || "quotation"}`}
    description="Everything priced comes across — shoots, services, deliverables and the rates it was raised under. The copy is a new quotation, never a new version of this one."
    size="md"
    busy={saving}
    onClose={onClose}
    footer={<>
      <Button type="button" onClick={onClose}>Cancel</Button>
      <Button type="button" variant="primary" disabled={saving} onClick={submit}>{saving ? "Duplicating…" : "Duplicate"}</Button>
    </>}
  >
    <form onSubmit={submit} className="space-y-5 pb-2">
      {/* Suggestions, not a closed list — the same rule the generator's Enquire ID follows, because
          a quotation is often raised for an enquiry the CRM has not been given yet. */}
      <ComboBoxField
        label="Duplicate to enquiry"
        required
        value={enquiryId}
        options={enquiryIdOptions}
        placeholder="Select or type enquire id"
        onChange={(value) => { setEnquiryId(value); setError(""); }}
      />
      {Boolean(error) && <p role="alert" className="text-xs text-red-600">{error}</p>}
      <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs leading-relaxed text-slate-600">
        {sameEnquiry
          ? "The copy becomes a second quotation for the same enquiry — its own row, its own number and a fresh five-day link. It is not a new version of this one; Edit is what raises those."
          : "The copy becomes a quotation of its own under that enquiry, with its own number and a fresh five-day link."}
        {" "}{quotation?.quotationId || "This version"} is left exactly as it is, and the link already sent for it keeps working.
      </p>
    </form>
  </Dialog>;
}
