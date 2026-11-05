"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import DataTableShell from "@/components/data-table/DataTableShell";
import DepartmentWhatsAppGroupsTable from "@/components/settings/DepartmentWhatsAppGroupsTable";
import DepartmentGroupsEditDialog from "@/components/settings/DepartmentGroupsEditDialog";
import { getDepartmentWhatsAppGroups } from "@/services/hrm/whatsapp-groups.service";

/**
 * Settings -> Employee -> WhatsApp Groups: which WhatsApp groups each department has.
 *
 * One row per **department**, with its groups as one comma-separated cell. That is the question
 * somebody actually asks - "which groups does Production have" - and the end the work happens from;
 * one row per group, with its departments listed, is the same fact read from the less useful end.
 * The row's ⋮ → **Edit** is the one place a department's groups are added and taken away.
 *
 * Every active department is a row, including those claiming no group: a department missing from the
 * table is one nobody would think to give groups to, and one with none is exactly what needs seeing.
 *
 * **What the list is for.** Onboarding adds a new employee to every group their departments claim, so
 * this is the list that decides it; being relieved takes them out of every group they are in. Nothing
 * here touches WhatsApp - changing this list changes what happens the next time somebody joins.
 *
 * `HRM / Employee Management`: Read shows the table, Read / Write offers Edit.
 */
export default function EmployeeWhatsAppGroupsPanel({ canWrite = false, onNotice, onError }) {
  const [rows, setRows] = useState(null);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    try {
      const result = await getDepartmentWhatsAppGroups();
      setRows(Array.isArray(result?.data) ? result.data : []);
    } catch (error) {
      setRows([]);
      onError?.(error?.message || "Unable to load the departments' WhatsApp groups.");
    }
  }, [onError]);
  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);

  /*
   * Every change answers with the whole table, so the open dialog is handed its own department back
   * from that same answer rather than re-reading: adding two groups one after another shows the
   * first without the dialog being closed and reopened.
   */
  const afterChange = useCallback((data, message) => {
    const next = Array.isArray(data) ? data : null;
    if (next) {
      setRows(next);
      setEditing((open) => (open ? next.find((row) => row.id === open.id) || null : null));
    } else {
      void load();
    }
    if (message) onNotice?.(message);
  }, [load, onNotice]);

  // A reader who may not edit gets a menu that says so, rather than one opening onto nothing.
  const items = useCallback((department) => (canWrite
    ? [{ label: "Edit", onSelect: () => setEditing(department) }]
    : [{ label: "Only someone who can edit employees changes these", disabled: true, onSelect: () => {} }]
  ), [canWrite]);

  return <div className="space-y-3">
    <p className="text-sm text-slate-600">
      Onboarding adds a new employee to every WhatsApp group their departments have, and being
      relieved takes them out of every group they are in. Editing a list here changes what happens the
      next time somebody joins or leaves; nobody is added or removed on WhatsApp by editing it.
    </p>

    <DataTableShell className="min-h-0">
      <DepartmentWhatsAppGroupsTable
        rows={rows || []}
        loading={rows === null}
        items={items}
        onOpen={canWrite ? setEditing : undefined}
        onExported={(exported) => onNotice?.(exported ? "Departments CSV downloaded." : "No rows available to export.")}
      />
    </DataTableShell>

    {editing && <DepartmentGroupsEditDialog
      department={editing}
      onClose={() => setEditing(null)}
      onChanged={afterChange}
      onError={onError}
    />}
  </div>;
}
