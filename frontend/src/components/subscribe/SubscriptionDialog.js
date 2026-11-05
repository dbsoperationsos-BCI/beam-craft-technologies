"use client";

import { useState } from "react";
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

function Chevron({ open }) {
  return <svg viewBox="0 0 20 20" aria-hidden="true" className={`h-4 w-4 text-slate-400 transition-transform ${open ? "rotate-90" : ""}`}><path fill="currentColor" d="M7.3 4.3a1 1 0 0 1 1.4 0l5 5a1 1 0 0 1 0 1.4l-5 5a1 1 0 1 1-1.4-1.4L11.6 10 7.3 5.7a1 1 0 0 1 0-1.4Z" /></svg>;
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
  // Modules the client has only part of start open, so what was chosen inside them is in view.
  const [open, setOpen] = useState(() => new Set(
    Object.entries(MODULES_BY_PRODUCT[pending?.product || row.product] || {})
      .filter(([module, { screens }]) => {
        const picked = Object.keys(screens).filter((screen) => form.modules.includes(`${module}/${screen}`)).length;
        return picked > 0 && picked < Object.keys(screens).length;
      })
      .map(([module]) => module),
  ));
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
  const toggleOpen = (module) => setOpen((current) => {
    const next = new Set(current);
    if (next.has(module)) next.delete(module); else next.add(module);
    return next;
  });
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
        <Dropdown required label="Product" placeholder="Select the product" value={form.product} onChange={(value) => set("product", value)} options={productOptions} />
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
      hint={form.product ? `Tick a module for all of its screens, or open it and pick only the screens they need. ${chosen.length} of ${allKeys.length} screens selected.` : "Choose the product to see its modules."}
      action={form.product ? <button type="button" onClick={() => set("modules", everything ? [] : allKeys)} className="shrink-0 rounded text-sm font-medium text-blue-700 hover:text-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">{everything ? "Clear all" : "Select all"}</button> : null}
    >
      {form.product && <ul className="divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200">
          {Object.entries(modules).map(([module, { label, screens }]) => {
            const keys = screenKeys(module);
            const picked = keys.filter((key) => form.modules.includes(key)).length;
            const isOpen = open.has(module);
            return <li key={module} className={picked ? "bg-blue-50/40" : "bg-white"}>
              <div className="flex items-center gap-3 px-3 py-2.5">
                <input
                  type="checkbox"
                  aria-label={`All of ${label}`}
                  className="h-4 w-4 shrink-0 accent-blue-600"
                  checked={picked === keys.length}
                  ref={(input) => { if (input) input.indeterminate = picked > 0 && picked < keys.length; }}
                  onChange={() => toggleModule(module)}
                />
                <button type="button" onClick={() => toggleOpen(module)} aria-expanded={isOpen} className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
                  <span className="truncate text-sm font-medium text-slate-800">{label}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className={`text-xs tabular-nums ${picked ? "text-blue-700" : "text-slate-400"}`}>{picked === keys.length ? "All screens" : picked ? `${picked} of ${keys.length} screens` : `${keys.length} screens`}</span>
                    <Chevron open={isOpen} />
                  </span>
                </button>
              </div>
              {isOpen && <div className="grid gap-x-4 gap-y-2 border-t border-slate-100 bg-white px-3 py-3 pl-10 sm:grid-cols-2">
                {Object.entries(screens).map(([screen, name]) => <label key={screen} className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" className="h-4 w-4 accent-blue-600" checked={form.modules.includes(`${module}/${screen}`)} onChange={() => toggleScreen(`${module}/${screen}`)} />
                  {name}
                </label>)}
              </div>}
            </li>;
          })}
        </ul>}
    </Section>
  </SchemaFormPanel>;
}
