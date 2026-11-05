"use client";

import { useState } from "react";
import AccountBalanceWallet from "@mui/icons-material/AccountBalanceWallet";
import AccountTree from "@mui/icons-material/AccountTree";
import Groups from "@mui/icons-material/Groups";
import Inventory2 from "@mui/icons-material/Inventory2";
import PhotoLibrary from "@mui/icons-material/PhotoLibrary";
import SupportAgent from "@mui/icons-material/SupportAgent";
import TrendingUp from "@mui/icons-material/TrendingUp";
import Widgets from "@mui/icons-material/Widgets";
import ToggleSwitch from "@/components/shared/ToggleSwitch";
import { clearDraft, useDraft } from "@/lib/stayOnRefresh";
import Button from "@/components/shared/Button";
import DateField from "@/components/shared/DateField";
import Dropdown from "@/components/shared/Dropdown";
import ShareableMessage from "@/components/shared/ShareableMessage";
import TextField from "@/components/shared/TextField";
import Dialog from "@/components/ui/Dialog";
import SchemaFormPanel from "@/components/schema-form/SchemaFormPanel";
import SchemaFormSection from "@/components/schema-form/SchemaFormSection";
import { saveClientSubscription } from "@/services/subscribe/client-onboarding.service";
import { MODULES_BY_PRODUCT, PRODUCTS, screensFrom, termEnd } from "@/constants/subscriptionProducts.mjs";

const productOptions = Object.entries(PRODUCTS).map(([value, label]) => ({ value, label }));
// Dates are the studio's, so "today" is today in India - not the UTC date, which lags until 05:30.
const todayIst = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const day = (value) => (value ? new Date(value).toISOString().slice(0, 10) : "");
const toSubdomain = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 40);
const errorMessage = (error, fallback) => error?.data?.message || error?.message || fallback;

const TERMS = [["6 months", 6], ["1 year", 12], ["2 years", 24]];

/** One of the panel's sections, with the line that says what it is for and an action beside it. */
function Section({ id, title, hint, action, children }) {
  return <SchemaFormSection id={id} title={title}>
    <div className="mb-4 flex items-start justify-between gap-3">
      <p className="text-sm text-slate-500">{hint}</p>
      {action}
    </div>
    {children}
  </SchemaFormSection>;
}

const SECTIONS = [["account", "Account"], ["validity", "Validity"], ["modules", "Modules"]];

// Each module's icon on its row; a module not listed gets the generic one.
const MODULE_ICONS = { hrm: Groups, "sales-crm": TrendingUp, "client-management": SupportAgent, "project-management": AccountTree, "visual-curation": PhotoLibrary, accounts: AccountBalanceWallet, "resource-management": Inventory2 };

/**
 * One module as a settings row: its icon and name, the screens it brings in grey, and a switch for all of
 * it. Only a module with several screens shows them as chips beneath, to pick one by one.
 */
function ModuleRow({ module, label, screens, selected, onToggleModule, onToggleScreen }) {
  const entries = Object.entries(screens);
  const keys = entries.map(([screen]) => `${module}/${screen}`);
  const picked = keys.filter((key) => selected.includes(key)).length;
  const all = picked === keys.length;
  const Icon = MODULE_ICONS[module] || Widgets;
  const summary = entries.length === 1 ? entries[0][1] : picked && !all ? `${picked} of ${entries.length} screens` : `${entries.length} screens`;
  return <li className="px-4 py-3.5">
    <div className="flex items-center gap-3">
      <span aria-hidden="true" className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors ${picked ? "bg-blue-50 text-blue-600" : "bg-slate-100 text-slate-400"}`}><Icon sx={{ fontSize: 20 }} /></span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-sm font-medium ${picked ? "text-slate-900" : "text-slate-600"}`}>{label}</span>
        <span className="block truncate text-xs text-slate-500">{summary}</span>
      </span>
      <ToggleSwitch ariaLabel={`${label}: all screens`} checked={all} mixed={picked > 0 && !all} onCheckedChange={() => onToggleModule(module)} />
    </div>
    {entries.length > 1 && <div className="mt-3 flex flex-wrap gap-1.5 pl-12" role="group" aria-label={`${label} screens`}>
      {entries.map(([screen, name]) => {
        const key = `${module}/${screen}`;
        const on = selected.includes(key);
        return <button key={screen} type="button" aria-pressed={on} onClick={() => onToggleScreen(key)} className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${on ? "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200" : "bg-white text-slate-500 ring-1 ring-inset ring-slate-200 hover:text-slate-800"}`}>{name}</button>;
      })}
    </div>}
  </li>;
}

/**
 * Client Details -> Set up account (first time) / Edit subscription: where the client logs in, how many
 * users besides its Admin, the Admin's username, how long it is valid, and which modules - down to the
 * screen - it gets. Saving the first time shows the Admin's password once, inside the message to send
 * the client; a forgotten password is reset from the row's own Reset password.
 */
export default function SubscriptionDialog({ row, onClose: close, onSaved }) {
  const client = row.client || {};
  const settingUp = !client.activatedAt;
  // A change already saved and waiting for Update site is what the form opens with.
  const pending = client.pendingChanges || null;
  // What is typed survives a refresh until it is saved or the panel is closed.
  const draftName = `subscription:${row.id}`;
  const onClose = () => { clearDraft(draftName); close?.(); };
  const [form, setForm] = useDraft(draftName, () => {
    if (pending) return { ...pending, usersAllowed: String(pending.usersAllowed), modules: screensFrom(pending.product, pending.modules), resetPassword: false };
    const validFrom = day(client.validFrom) || todayIst();
    return {
      product: row.product || "",
      subdomain: client.subdomain || toSubdomain(client.companyName),
      usersAllowed: String(client.usersAllowed ?? client.usersNeeded ?? ""),
      adminUsername: client.adminUsername || client.subdomain || toSubdomain(client.companyName),
      validFrom,
      validUntil: day(client.validUntil) || termEnd(validFrom, 12),
      modules: screensFrom(row.product, client.modules),
      resetPassword: false,
    };
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [sent, setSent] = useState(null);

  const set = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const modules = MODULES_BY_PRODUCT[form.product] || {};
  const allKeys = Object.entries(modules).flatMap(([module, { screens }]) => Object.keys(screens).map((screen) => `${module}/${screen}`));
  const chosen = screensFrom(form.product, form.modules);
  const screenKeys = (module) => Object.keys(modules[module].screens).map((screen) => `${module}/${screen}`);
  const toggleScreen = (key) => set("modules", form.modules.includes(key) ? form.modules.filter((item) => item !== key) : [...form.modules, key]);
  // A module's own box ticks or clears all of its screens at once.
  const toggleModule = (module) => {
    const keys = screenKeys(module);
    const all = keys.every((key) => form.modules.includes(key));
    set("modules", all ? form.modules.filter((key) => !keys.includes(key)) : [...new Set([...form.modules, ...keys])]);
  };
  const everything = allKeys.length > 0 && chosen.length === allKeys.length;

  async function save(event) {
    event?.preventDefault?.();
    setSaving(true);
    setError("");
    try {
      // Only the chosen product's screens travel, so switching product never sends a stale tick.
      const body = { ...form, usersAllowed: Number(form.usersAllowed), modules: chosen };
      const result = await saveClientSubscription(row.id, body);
      clearDraft(draftName);
      onSaved?.(result?.data?.accountMessage ? null : result?.message);
      if (result?.data?.accountMessage) setSent(result.data.accountMessage);
      else onClose?.();
    } catch (requestError) {
      setError(errorMessage(requestError, "Unable to save the account."));
    } finally {
      setSaving(false);
    }
  }

  if (sent) return <Dialog title="Account Ready" description={client.companyName || undefined} size="md" onClose={onClose} footer={<Button className="max-sm:flex-1" type="button" onClick={onClose}>Close</Button>}>
    <ShareableMessage label="Message to send them" rows={10} message={sent} />
    <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">This password is shown only once. Copy the message before closing.</p>
  </Dialog>;

  return <SchemaFormPanel
    title={settingUp ? "Set Up Account" : "Edit Subscription"}
    description={settingUp ? client.companyName || undefined : `${client.companyName || "Client"} - live on v${client.liveVersion || 1}. Saving keeps the change pending until you use Update site.`}
    sections={SECTIONS}
    values={{}}
    onChange={() => {}}
    validateRequired={false}
    sidebarAriaLabel="Account sections"
    closeAriaLabel="Close"
    onClose={onClose}
    onSubmit={save}
    error={error}
    saving={saving}
    submitLabel={settingUp ? "Set up account" : "Save as pending"}
    savingLabel="Saving..."
  >
    {pending && <p className="mx-4 mt-4 rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-800 sm:mx-6">These changes are saved but not live yet. Use Update site in Client Details to put them live.</p>}
    <Section id="account" title="Account" hint="Where the client logs in and who their Admin is.">
      <div className="grid gap-4 md:grid-cols-2">
        <Dropdown required sorted={false} label="Product" placeholder="Select the product" value={form.product} onChange={(value) => set("product", value)} options={productOptions} />
        {/* The whole address pasted in is kept as its subdomain: "velava.beamcraft.tech" is "velava". */}
        <TextField required label="Subdomain" value={form.subdomain} onChange={(event) => set("subdomain", event.target.value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "").replace(/\.beamcraft\.tech$/, ""))} />
        <TextField required label="Admin Username" value={form.adminUsername} onChange={(event) => set("adminUsername", event.target.value.trim())} />
        <TextField required type="number" min={1} step={1} label="Number Of Users" value={form.usersAllowed} onChange={(event) => set("usersAllowed", event.target.value)} />
      </div>
    </Section>

    <Section
      id="validity"
      title="Validity"
      hint="The account works from the first day through the last."
      action={<div className="flex shrink-0 gap-1.5" role="group" aria-label="Set the term">
        {TERMS.map(([label, months]) => {
          const active = Boolean(form.validFrom) && form.validUntil === termEnd(form.validFrom, months);
          return <button key={label} type="button" disabled={!form.validFrom} onClick={() => set("validUntil", termEnd(form.validFrom, months))} className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${active ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-300 text-slate-600 hover:bg-slate-50"}`}>{label}</button>;
        })}
      </div>}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <DateField required label="Valid From" value={form.validFrom} onChange={(value) => set("validFrom", value)} />
        <DateField required label="Valid Until" value={form.validUntil} minDate={form.validFrom} onChange={(value) => set("validUntil", value)} />
      </div>
    </Section>

    <Section
      id="modules"
      title="Modules"
      hint={form.product ? `Choose what the client gets. ${chosen.length} of ${allKeys.length} screen${allKeys.length === 1 ? "" : "s"} on.` : "Choose the product to see its modules."}
      action={form.product ? <button type="button" onClick={() => set("modules", everything ? [] : allKeys)} className="shrink-0 rounded text-sm font-medium text-blue-700 hover:text-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">{everything ? "Clear all" : "Select all"}</button> : null}
    >
      {form.product && <ul className="max-w-2xl divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
        {Object.entries(modules).map(([module, { label, screens }]) => <ModuleRow key={module} module={module} label={label} screens={screens} selected={form.modules} onToggleModule={toggleModule} onToggleScreen={toggleScreen} />)}
      </ul>}
    </Section>
  </SchemaFormPanel>;
}
