"use client";

import { useMemo, useState } from "react";
import Tabs from "@/components/ui/Tabs";
import HrmOptionListEditor from "@/components/shared/HrmOptionListEditor";
import { QUOTATION_BRANDS } from "@/lib/quotationBrand.mjs";
import { deleteMasterData, getMasterData, saveMasterData } from "@/services/hrm/master-data.service";

/**
 * A Field Settings list kept per vertical - one tab per brand over the standard editor.
 *
 * The quotation's Categories are the list this exists for: Dum Dum's categories are not Qua Qua's,
 * and Corp's are neither, so one flat list would offer every brand's answers on every brand's form.
 * The rows still live in one master-data resource; what the tab decides is which brand's rows are
 * read and which brand a new row is filed under. Renaming and removing a row need no brand, since
 * the row already carries its own.
 *
 * The same shape as `QuotationShootTypeEditor`, which tabs the brands over their shoots - except
 * that this list stages its edits like every other Field Settings list, so the Save and Cancel on
 * the picker row above act on the tab that is open. Switching tab throws staged work away exactly
 * as changing the Field picker does, and asks first through the same guard.
 */
export default function VerticalScopedListEditor({ list, guardChange = (move) => move(), onError, ...editorProps }) {
  const [vertical, setVertical] = useState(QUOTATION_BRANDS[0]?.code || "DUM_DUM");

  /*
   * The editor's calls, pointed at this brand. Rebuilt when the tab changes and not otherwise, so
   * the editor reloads on a tab change and on nothing else.
   */
  const api = useMemo(() => ({
    list: (resource) => getMasterData(resource, { vertical }),
    add: (resource, name) => saveMasterData(resource, { name, vertical }),
    rename: (resource, id, name) => saveMasterData(resource, { name }, id),
    remove: (resource, id) => deleteMasterData(resource, id),
    setFlag: (resource, id, field, value) => saveMasterData(resource, { [field]: value }, id),
  }), [vertical]);

  const brand = QUOTATION_BRANDS.find((item) => item.code === vertical);

  return <div className="space-y-4">
    <Tabs
      tabs={QUOTATION_BRANDS.map((item) => ({ id: item.code, label: item.label }))}
      value={vertical}
      onChange={(next) => { if (next !== vertical) guardChange(() => setVertical(next)); }}
      ariaLabel={`${list.label} by brand`}
    />
    {/* Keyed by brand so switching tab draws a fresh editor rather than one still holding the
        previous brand's staged rows, search text and half-typed Add box. */}
    <HrmOptionListEditor
      key={`${list.value}:${vertical}`}
      resource={list.value}
      label={`${brand?.label || "Brand"} ${list.label}`}
      singular={list.singular}
      api={api}
      onError={onError}
      {...editorProps}
    />
  </div>;
}
