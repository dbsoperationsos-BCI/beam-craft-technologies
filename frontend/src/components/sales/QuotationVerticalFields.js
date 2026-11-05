"use client";

import ComboBoxField from "@/components/shared/ComboBoxField";
import DateField from "@/components/shared/DateField";
import Dropdown from "@/components/shared/Dropdown";
import PhoneField from "@/components/shared/PhoneField";
import TextField from "@/components/shared/TextField";
import useBranchOptions from "@/components/sales/useBranchOptions";
import useLeadSuggestionLists from "@/components/sales/useLeadSuggestionLists";
import { verticalFieldRows } from "./quotationVerticalConfig";

/**
 * The Client Details rows for the chosen vertical.
 *
 * One renderer over the row data in `quotationVerticalConfig.js`, so all three verticals get the
 * same field heights, the same three-column grid and the same behaviour on a phone. Rows collapse
 * to a single column below `md`, which is what keeps the form usable at ~360px.
 */
export default function QuotationVerticalFields({ vertical, values, onChange }) {
  const rows = verticalFieldRows[vertical] || [];
  /*
   * The studio's branches, not a list written into this file. It held its own copy of the CRM's
   * six - and the CRM's six were not branches: `Erode` where the studio has `Erode TN`. A quotation
   * and the lead it was raised for have to name the same branch, so both read the same answer.
   */
  const { branches: branchOptions } = useBranchOptions();
  // Relationship and Referred From, from Settings -> Field Settings -> Quotation - the same list the
  // CRM suggests on Add Lead, so a lead and the quotation raised for it spell a source one way.
  // Category comes from the same place, under this vertical's own tab.
  const suggestions = useLeadSuggestionLists({ vertical });

  function renderField(item) {
    const value = values[item.key] || "";
    const shared = { label: item.label, required: item.required, value };

    if (item.type === "phone") {
      return <PhoneField key={item.key} {...shared} onChange={(_field, phone) => onChange(item.key, phone)} />;
    }
    if (item.type === "date") {
      return <DateField key={item.key} {...shared} onChange={(next) => onChange(item.key, next)} />;
    }
    if (item.type === "combo") {
      return <ComboBoxField key={item.key} {...shared} options={suggestions[item.key] || item.options} onChange={(next) => onChange(item.key, next)} />;
    }
    if (item.type === "select") {
      // The studio's own list where there is one for this field - Offer Type - and the list the
      // row was written with otherwise, exactly as the combo above does it.
      return <Dropdown key={item.key} {...shared} mode="input" ariaLabel={item.label} options={suggestions[item.key] || item.options} onChange={(next) => onChange(item.key, next)} />;
    }
    if (item.type === "branch") {
      return <Dropdown key={item.key} {...shared} mode="input" searchable ariaLabel={item.label} options={branchOptions} onChange={(next) => onChange(item.key, next)} />;
    }
    return <TextField key={item.key} {...shared} placeholder={item.placeholder} onChange={(event) => onChange(item.key, event.target.value)} />;
  }

  return <div className="space-y-5">
    {rows.map((row, index) => <div key={index} className="grid gap-5 md:grid-cols-3">{row.map(renderField)}</div>)}
  </div>;
}
