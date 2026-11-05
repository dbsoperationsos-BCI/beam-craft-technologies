"use client";

import { useMemo, useState } from "react";
import Tabs from "@/components/ui/Tabs";
import HrmOptionListEditor from "@/components/shared/HrmOptionListEditor";
import { QUOTATION_BRANDS } from "@/lib/quotationBrand.mjs";
import { getQuotationBrandAdminConfiguration, createQuotationBrandShoot, updateQuotationBrandShoot, deleteQuotationBrandShoot } from "@/services/sales/quotation-brands.service";

/**
 * The shoots each brand quotes for — Settings → Field Settings → Quotation → Shoot Type.
 *
 * One tab per brand, because the lists are the brands' own: Dum Dum photographs a Sangeeth and Qua
 * Qua photographs a Naming ceremony, and neither offers the other's. They were the constant
 * `BRAND_SHOOTS` on the server, so a studio that started doing a new kind of shoot under a brand
 * had no way to say so.
 *
 * What is edited here is read in two other places, which is the whole reason it is one list:
 *
 *   - the Quotation Generator's **Add Shoot**, which offers a quotation only the shoots its brand
 *     quotes for; and
 *   - **Quotation Settings → *brand* → PDF Content**, where each cover and Thank You picture set
 *     names the shoots it answers for.
 *
 * The rows and the screen around them are `HrmOptionListEditor`, the same editor every other list on
 * this screen uses — Add, rename, remove, a search, each saving as it is made. Only where the rows
 * come from differs, which is what its `api` prop is for: a brand's shoots live on the brand rather
 * than in the HRM master data.
 */
export default function QuotationShootTypeEditor({ onError }) {
  const [brand, setBrand] = useState(QUOTATION_BRANDS[0]?.code || "DUM_DUM");

  /*
   * The four calls the editor makes, pointed at this brand.
   *
   * Rebuilt when the brand changes and not otherwise - the editor reloads whenever this identity
   * changes, which is exactly what switching tab should do and exactly what typing into the search
   * box should not.
   *
   * The *admin* read rather than the cached one every other screen uses. Two reasons: it is never
   * cached, so this screen sees its own edit rather than the answer from before it; and it carries
   * `shootRows`, the shoots as rows with their ids. The plain `shoots` list is names alone - all a
   * quotation ever stores of a shoot - and a rename or a remove needs the row it came from.
   */
  const api = useMemo(() => ({
    list: async () => {
      const response = await getQuotationBrandAdminConfiguration(brand);
      return { data: response?.data?.shootRows || [] };
    },
    add: (_resource, name) => createQuotationBrandShoot(brand, { name }),
    rename: (_resource, id, name) => updateQuotationBrandShoot(brand, id, { name }),
    remove: (_resource, id) => deleteQuotationBrandShoot(brand, id),
  }), [brand]);

  const label = QUOTATION_BRANDS.find((item) => item.code === brand)?.label || "Brand";

  return <div className="space-y-4">
    <Tabs
      tabs={QUOTATION_BRANDS.map((item) => ({ id: item.code, label: item.label }))}
      value={brand}
      onChange={setBrand}
      ariaLabel="Quotation brand"
    />
    {/* Keyed by brand so switching tab draws a fresh editor rather than one still holding the
        previous brand's search text and half-typed Add box. */}
    <HrmOptionListEditor
      key={brand}
      resource={`quotation-shoots:${brand}`}
      label={`${label} Shoots`}
      singular="Shoot"
      api={api}
      onError={onError}
    />
  </div>;
}
