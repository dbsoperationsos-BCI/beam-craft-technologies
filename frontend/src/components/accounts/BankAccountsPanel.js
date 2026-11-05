"use client";

import { useCallback, useEffect, useState } from "react";
import SchemaFormPanel from "@/components/schema-form/SchemaFormPanel";
import SchemaFormSection from "@/components/schema-form/SchemaFormSection";
import Button from "@/components/shared/Button";
import Dropdown from "@/components/shared/Dropdown";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import Loader from "@/components/shared/Loader";
import TextField from "@/components/shared/TextField";
import Dialog from "@/components/ui/Dialog";
import OptionsMenu from "@/components/ui/OptionsMenu";
import { layers } from "@/constants/layers";
import { deleteMasterData, getMasterData, saveMasterData } from "@/services/hrm/master-data.service";
import { BANK_ACCOUNT_TYPES, bankAccountFields } from "@/constants/accountsConfig";
import useEditableLists from "@/components/shared/useEditableLists";

const RESOURCE = "bank-accounts";

/**
 * The code is derived from the bank and branch rather than asked for: it is the master-data key
 * every list in this app carries, and nobody maintaining bank accounts should have to invent one.
 */
const toCode = (name) => name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 50);

const formatMoment = (value) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

/**
 * When the account was last touched, said once. An account that has never been edited reads as
 * added; one that has reads as updated, because that is the date somebody checking it cares about.
 * Who did it is recorded on the row either way — it is simply not what this line is for.
 */
const lastTouched = (record) => {
  if (!record.createdAt) return null;
  const edited = record.updatedAt && record.updatedAt !== record.createdAt;
  return `${edited ? "Updated" : "Added"} on ${formatMoment(edited ? record.updatedAt : record.createdAt)}`;
};

const emptyForm = { name: "", accountHolderName: "", accountNumber: "", ifscCode: "", accountType: "" };

function errorMessage(error, fallback) {
  if (error?.status === 401 || error?.status === 403) return "Your session has expired. Please sign in again.";
  return error?.data?.message || error?.message || fallback;
}

/**
 * The studio's bank accounts, and the details needed to pay into one.
 *
 * A list of its own rather than another master-data name list: an account is not just a label, and
 * the holder, number, IFSC and type all have to be right before money is sent anywhere. The formats
 * match the ones the employee and onboarding forms enforce, and the server checks them again.
 *
 * `name` is the bank and branch, and doubles as the label every account picker shows — which is why
 * it is the one field a cash entry stores, and why renaming an account here cannot rewrite what a
 * past entry says it was paid into.
 */
export default function BankAccountsPanel({ onClose }) {
  /*
   * What a studio account may be, from Settings → Fields → Accounts Manager. It was the array in
   * `accountsConfig.js` here and a `z.enum` built from a second copy on the server, so a type
   * added to one was offered by the form and refused on save. `BANK_ACCOUNT_TYPES` is what both
   * fall back to.
   */
  const { accountTypes } = useEditableLists({ accountTypes: ["bank-account-types", BANK_ACCOUNT_TYPES] });
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null);
  const [editing, setEditing] = useState(null);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);
  const { notice, showSuccess, showError, clearNotice } = useNotice();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getMasterData(RESOURCE);
      setRecords(Array.isArray(result?.data) ? result.data : []);
    } catch (error) {
      setRecords([]);
      showError(errorMessage(error, "Unable to load bank accounts."));
    } finally {
      setLoading(false);
    }
  }, [showError]);

  // Deferred a tick so the first render is not the one that flips the list into loading, matching
  // how the Accounts Manager and Payment Requests pages start their own fetches.
  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);

  const update = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => (current[field] ? { ...current, [field]: "" } : current));
  };

  function validate() {
    const next = {};
    if (!form.name.trim()) next.name = "Enter the bank name and branch.";
    if (!form.accountHolderName.trim()) next.accountHolderName = "Enter the account holder's name.";
    if (!/^\d{9,18}$/.test(form.accountNumber.trim())) next.accountNumber = "9 to 18 digits.";
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(form.ifscCode.trim().toUpperCase())) next.ifscCode = "e.g. SBIN0001234.";
    if (!form.accountType) next.accountType = "Choose the account type.";
    return next;
  }

  async function save() {
    const problems = validate();
    setErrors(problems);
    if (Object.values(problems).some(Boolean)) return;

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        accountHolderName: form.accountHolderName.trim(),
        accountNumber: form.accountNumber.trim(),
        ifscCode: form.ifscCode.trim().toUpperCase(),
        accountType: form.accountType,
        // Only a new account mints a code; renaming one keeps the key entries were saved against.
        ...(editing ? {} : { code: toCode(form.name) }),
      };
      await saveMasterData(RESOURCE, payload, editing?.id);
      showSuccess(editing ? `${payload.name} updated.` : `${payload.name} added.`);
      setForm(null);
      setEditing(null);
      await load();
    } catch (error) {
      showError(errorMessage(error, "Unable to save this bank account."));
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    setBusy(true);
    try {
      await deleteMasterData(RESOURCE, deleting.id);
      const name = deleting.name;
      setDeleting(null);
      showSuccess(`${name} removed.`);
      await load();
    } catch (error) {
      showError(errorMessage(error, "Unable to remove this bank account."));
    } finally {
      setBusy(false);
    }
  }

  const startAdd = () => { setEditing(null); setErrors({}); setForm({ ...emptyForm }); };
  const startEdit = (record) => {
    setEditing(record);
    setErrors({});
    setForm({
      name: record.name || "",
      accountHolderName: record.accountHolderName || "",
      accountNumber: record.accountNumber || "",
      ifscCode: record.ifscCode || "",
      accountType: record.accountType || "",
    });
  };

  return <>
    <SchemaFormPanel
      title="Accounts Settings"
      description="The studio's bank accounts. A cash entry names one of these rather than typing an account, so what is here is what the entry form offers."
      sections={[["bank-accounts", "Bank Accounts"]]}
      sidebarAriaLabel="Accounts settings sections"
      closeAriaLabel="Close accounts settings"
      onClose={onClose}
      onSubmit={(event) => event.preventDefault()}
      footer={<Button className="ml-auto max-sm:w-full" type="button" variant="primary" onClick={onClose}>Done</Button>}
    >
      <SchemaFormSection id="bank-accounts" title="Bank Accounts">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-slate-500 sm:text-sm">{records.length} account{records.length === 1 ? "" : "s"}</p>
          <Button type="button" variant="primary" onClick={startAdd}>Add Bank Account</Button>
        </div>

        {loading ? <Loader label="Loading bank accounts..." /> : records.length === 0
          ? <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">No bank accounts yet. Add one and the entry form will offer it.</p>
          : <ul className="space-y-3">
            {records.map((record) => <li key={record.id} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 sm:p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900">{record.name}</p>
                  <p className="mt-0.5 truncate text-xs text-slate-500">{record.accountHolderName || "No account holder recorded"}</p>
                </div>
                <OptionsMenu
                  ariaLabel={`Actions for ${record.name}`}
                  menuZIndexClassName={layers.menuOverPanel}
                  items={[
                    { label: "Edit", onSelect: () => startEdit(record) },
                    { label: "Delete", tone: "danger", onSelect: () => setDeleting(record) },
                  ]}
                />
              </div>
              {/* An account recorded before these columns existed shows dashes rather than blanks,
                  so it is obvious which ones still need completing. */}
              <dl className="mt-3 grid gap-x-4 gap-y-2 border-t border-slate-200 pt-3 sm:grid-cols-3">
                {bankAccountFields.map(([key, label]) => <div key={key} className="min-w-0">
                  <dt className="text-[11px] font-semibold text-slate-500">{label}</dt>
                  <dd className="mt-0.5 truncate text-xs text-slate-800">{record[key] || "—"}</dd>
                </div>)}
              </dl>
              {lastTouched(record) && <p className="mt-3 border-t border-slate-200 pt-2 text-[11px] text-slate-500">{lastTouched(record)}</p>}
            </li>)}
          </ul>}
      </SchemaFormSection>
    </SchemaFormPanel>

    <FloatingNotice notice={notice} onClose={clearNotice} />

    {form && <Dialog
      size="lg"
      layer="dialogOverPanel"
      title={editing ? `Edit ${editing.name}` : "Add Bank Account"}
      description="The bank and branch is the label a cash entry will show; the rest is what is needed to pay into it."
      busy={saving}
      onClose={() => { setForm(null); setEditing(null); }}
      onSubmit={(event) => { event.preventDefault(); void save(); }}
      footer={<>
        <Button className="max-sm:flex-1" type="button" onClick={() => { setForm(null); setEditing(null); }} disabled={saving}>Cancel</Button>
        <Button className="max-sm:flex-1" variant="primary" disabled={saving}>{saving ? "Saving..." : editing ? "Update Account" : "Add Account"}</Button>
      </>}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField required className="sm:col-span-2" label="Bank Name & Branch" value={form.name} error={errors.name} onChange={(event) => update("name", event.target.value)} placeholder="e.g. Union Bank — Erode" />
        <TextField required label="Account Holder Name" value={form.accountHolderName} error={errors.accountHolderName} onChange={(event) => update("accountHolderName", event.target.value)} placeholder="As printed on the passbook" />
        <TextField required label="Bank Account Number" inputMode="numeric" maxLength={18} value={form.accountNumber} error={errors.accountNumber} onChange={(event) => update("accountNumber", event.target.value.replace(/\D/g, ""))} placeholder="9 to 18 digits" />
        <TextField required label="IFSC / Routing Code" value={form.ifscCode} error={errors.ifscCode} onChange={(event) => update("ifscCode", event.target.value.toUpperCase())} placeholder="SBIN0001234" />
        <Dropdown required label="Account Type" value={form.accountType} error={errors.accountType} onChange={(value) => update("accountType", value)} options={accountTypes} placeholder="Select the account type" />
      </div>
    </Dialog>}

    {deleting && <Dialog
      layer="dialogOverPanel"
      title={`Remove ${deleting.name}?`}
      description="It stops being offered on the entry form. Entries already recorded against it keep the account name they were saved with."
      busy={busy}
      onClose={() => setDeleting(null)}
      footer={<>
        <Button className="max-sm:flex-1" type="button" onClick={() => setDeleting(null)} disabled={busy}>Cancel</Button>
        <Button className="max-sm:flex-1" type="button" variant="danger" onClick={confirmDelete} disabled={busy}>{busy ? "Removing..." : "Remove Account"}</Button>
      </>}
    />}
  </>;
}
