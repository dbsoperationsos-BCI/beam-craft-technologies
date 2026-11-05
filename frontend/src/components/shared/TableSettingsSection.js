"use client";

import { useCallback, useEffect, useState } from "react";
import TableSettingsPanel from "@/components/sales/TableSettingsPanel";
import { apiRequest } from "@/services/api/client";

/**
 * Table Settings as a section, for any Settings panel that wants it.
 *
 * The builder itself is `TableSettingsPanel` and is unchanged - it already asks which module and
 * which vertical it is editing, and it has always been able to offer every module in the OS. What
 * it did not have was a way in from outside the CRM's own Settings, so the one screen that decides
 * what a module's table and form carry could only be reached from one module.
 *
 * The loading and the saving live here rather than in each caller, so a second way in cannot drift
 * from the first: both read and write the same endpoint in the same shape.
 */

/*
 * The response is a flat list across every vertical; the builder reads it keyed by vertical, in the
 * order the fields were left in. Kept in step with the same grouping in the CRM's Settings overlay.
 */
export function groupFieldsByVertical(rows) {
  return (Array.isArray(rows) ? rows : []).reduce((grouped, row) => {
    if (!row?.branch || !row?.key || !row?.label) return grouped;
    if (!grouped[row.vertical]) grouped[row.vertical] = [];
    grouped[row.vertical].push({
      key: row.key,
      label: row.label,
      fieldType: row.fieldType || "text",
      placeholder: row.placeholder || "",
      required: Boolean(row.required),
      options: Array.isArray(row.options) ? row.options : [],
    });
    return grouped;
  }, {});
}

/**
 * The builder plus the loading and saving it needs, with no panel around it.
 *
 * Separated so it can be a section inside another Settings panel - Employee Settings has it beside
 * its option lists - as well as a panel of its own. One copy of the fetch and the save either way.
 */
export default function TableSettingsSection({ verticalOptions, onSaved, unsavedRef }) {
  const [fieldsByVertical, setFieldsByVertical] = useState({});
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void apiRequest("/api/sales/crm-leads/table-settings")
      .then((response) => { if (active) setFieldsByVertical(groupFieldsByVertical(response?.data)); })
      .catch((requestError) => { if (active) setError(requestError?.message || "Unable to load the table settings."); });
    return () => { active = false; };
  }, []);

  const save = useCallback(async (savedVertical, fields) => {
    const response = await apiRequest("/api/sales/crm-leads/table-settings", {
      method: "PUT",
      body: JSON.stringify({ vertical: savedVertical, fields }),
    });
    const saved = groupFieldsByVertical(response?.data)[savedVertical] || [];
    setFieldsByVertical((current) => ({ ...current, [savedVertical]: saved }));
    onSaved?.(savedVertical, saved);
    return response;
  }, [onSaved]);

  return <div className="space-y-3">
    {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    <TableSettingsPanel
      verticalOptions={verticalOptions}
      fieldsByVertical={fieldsByVertical}
      onSaved={save}
      onError={setError}
      unsavedRef={unsavedRef}
    />
  </div>;
}
