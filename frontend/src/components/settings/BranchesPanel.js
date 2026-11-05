"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Search from "@mui/icons-material/Search";
import Button from "@/components/shared/Button";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import ImageUploadField from "@/components/shared/ImageUploadField";
import Loader from "@/components/shared/Loader";
import TextField from "@/components/shared/TextField";
import ToggleSwitch from "@/components/shared/ToggleSwitch";
import Dialog from "@/components/ui/Dialog";
import OptionsMenu from "@/components/ui/OptionsMenu";
import { layers } from "@/constants/layers";
import { fieldError } from "@/constants/fieldValidation";
import { branchesMatchingSearch } from "@/lib/branchName";
import { getBranches, saveBranch, setBranchActive } from "@/services/admin/branches.service";
import { branchRegistryChanged } from "@/lib/branchRegistry.mjs";
import { searchPostOffices } from "@/services/location/india-post.service";

/**
 * Settings → Organization → Branches: the studio's branch register.
 *
 * A branch was already a record the whole application points at — a user's home branch, an asset's
 * location, the branches a role reaches, the code inside a project's identifier. It simply had
 * nowhere to be *kept*. This is that place, and it adds to the same row rather than inventing a
 * second idea of a branch, so a branch created here is immediately one every picker offers.
 *
 * What a branch holds beyond its name is what a document needs to name it: where it trades from,
 * how to reach it, what it is registered as (GSTIN and PAN) and where it banks. All of it optional,
 * because a studio fills a branch in over time and a half-finished branch still has to be usable.
 *
 * Two rules are the server's, not this screen's, and it only reflects them: exactly one branch may
 * be the head office, and a branch that anything still points at is closed rather than deleted.
 *
 * Reached only with ADMIN / System Settings write — the same permission that decides whether the
 * Organization section appears at all, and the same one the endpoints behind this check again.
 */

/** An empty form: a branch is a name and nothing else until somebody fills the rest in. */
const emptyForm = {
  code: "", name: "", addressLine1: "", addressLine2: "", city: "", state: "", postalCode: "",
  phone: "", alternatePhone: "", email: "", websiteUrl: "",
  gstNumber: "", panNumber: "",
  bankAccountName: "", bankName: "", bankAccountNumber: "", bankIfsc: "",
  qrCodeUrl: "",
  isHeadOffice: false,
};

/*
 * Whether a branch is open is deliberately not on this form.
 *
 * It is not something anybody sets by hand: a branch is open from the day it is added, and it is
 * disabled from the row's own menu, which is a decision about the branch rather than a field. A
 * toggle for it
 * offered a second way to say the same thing and a way to reopen a branch by accident while
 * editing its bank details. The row still shows a closed branch as closed, and the column is
 * still the server's to set.
 */

/** What each row shows under the name, in the order it is read. */
const SUMMARY_FIELDS = [
  ["gstNumber", "GSTIN"],
  ["panNumber", "PAN"],
  ["phone", "Phone"],
  ["alternatePhone", "Alternate Phone"],
  ["email", "Email"],
  ["websiteUrl", "Website"],
  ["bankName", "Bank"],
  ["bankAccountNumber", "Account No."],
  ["bankIfsc", "IFSC"],
];

/** The address parts as one line, for the row under a branch's name. Whatever is missing is skipped. */
const addressLineOf = (branch) => [branch.addressLine1, branch.addressLine2, branch.city, branch.state, branch.postalCode]
  .map((part) => String(part ?? "").trim())
  .filter(Boolean)
  .join(", ");

/*
 * What a branch must have before it can be saved.
 *
 * A branch is named on documents — an invoice, a quotation, a receipt — and each of these is
 * something such a document has to carry. The server holds the same list and refuses the same save.
 *
 * Field names only, with no message each: a blank one is not reported under its own box. The
 * asterisk beside the label already marks it, and the form says once, in the snackbar, that
 * something is still missing — see `save`.
 *
 * Left out on purpose: the second address line, the alternate phone and the email. Each is a
 * second way to say something the branch already says.
 *
 * And the GSTIN and the PAN, which used to be on this list. A branch is not always a registration —
 * a new place trades before its GSTIN comes through — so a branch is now saveable without them.
 * What is typed into either box is still checked, in `validate`: an invalid GSTIN is refused, a
 * missing one is not. The server's list matches, field for field.
 */
const REQUIRED_FIELDS = [
  "code", "name",
  "addressLine1", "postalCode", "city", "state",
  "phone",
  "bankAccountName", "bankName", "bankAccountNumber", "bankIfsc",
];

function errorMessage(error, fallback) {
  if (error?.status === 401 || error?.status === 403) return "Your session has expired. Please sign in again.";
  return error?.data?.message || error?.message || fallback;
}

export default function BranchesPanel() {
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null);
  const [editing, setEditing] = useState(null);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  // The branch a confirmation is open for, and which way it is being turned: `{ branch, next }`.
  const [disabling, setDisabling] = useState(null);
  // Whether the head-office switch is waiting to be confirmed; see `toggleHeadOffice`.
  const [confirmHeadOffice, setConfirmHeadOffice] = useState(false);
  // Whether the PIN code is being looked up, which the City box says while it waits.
  const [lookingUp, setLookingUp] = useState(false);
  const [busy, setBusy] = useState(false);
  /*
   * What has been typed into the search box.
   *
   * The whole register is already in the browser — a studio has a handful of branches — so this
   * narrows what is on screen and asks the server nothing. Kept out of `load`, so a branch saved
   * while a search is on does not clear what was typed.
   */
  const [query, setQuery] = useState("");
  const { notice, showSuccess, showError, clearNotice } = useNotice();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getBranches();
      setBranches(Array.isArray(result?.data) ? result.data : []);
    } catch (error) {
      setBranches([]);
      showError(errorMessage(error, "Unable to load branches."));
    } finally {
      setLoading(false);
    }
  }, [showError]);

  // Deferred a tick, which is this codebase's convention for a first load: a fetch started straight
  // from an effect body counts as state set during that effect.
  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);

  const update = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => (current[field] ? { ...current, [field]: "" } : current));
  };

  /*
   * A finished PIN code fills in the city and the state, from the same India Post lookup the vendor
   * form uses — the studio should not type what the postal service already knows.
   *
   * It only fills a box that is empty. A PIN typed after the city has been written by hand would
   * otherwise overwrite it, and being corrected by a form is worse than typing two words. Both
   * stay editable either way, and a PIN that matches nothing simply fills nothing: an address is
   * still an address without them, and a lookup that fails is not the studio's problem to solve.
   */
  async function changePostalCode(raw) {
    const digits = String(raw ?? "").replace(/\D/g, "").slice(0, 6);
    update("postalCode", digits);
    if (digits.length !== 6) return;
    setLookingUp(true);
    try {
      const offices = await searchPostOffices(digits);
      const first = offices?.[0];
      if (!first) return;
      setForm((current) => (current ? {
        ...current,
        city: String(current.city || "").trim() ? current.city : (first.city || first.district || ""),
        state: String(current.state || "").trim() ? current.state : (first.state || ""),
      } : current));
    } catch {
      // Nothing to say: the two boxes are there to be typed into.
    } finally {
      setLookingUp(false);
    }
  }

  /*
   * Only the name is required; everything else is judged only once it has something in it.
   *
   * The formats come from `fieldValidation`, the same file the employee and onboarding forms read,
   * so a PAN is a PAN everywhere in this application. The server checks all of it again — this is
   * here to say what is wrong while somebody is still typing.
   */
  /** Whether anything a branch must have has been left blank. The asterisks say which. */
  const anythingMissing = () => REQUIRED_FIELDS.some((field) => !String(form[field] ?? "").trim());

  function validate() {
    const next = {};
    const checks = [["gstNumber", "gstin"], ["panNumber", "pan"], ["bankIfsc", "ifsc"], ["bankAccountNumber", "accountNumber"], ["email", "email"], ["phone", "phone"], ["alternatePhone", "phone"]];
    // Loosely, and only if there is something there: enough to catch a sentence typed into the
    // box, not enough to argue with a real address. The server checks the same shape.
    const site = String(form.websiteUrl || "").trim();
    if (site && !/^(https?:\/\/)?[^\s/?#]+\.[^\s]*$/i.test(site)) next.websiteUrl = "Enter a valid web address, for example beamcraft.in.";
    // A PIN code is six digits or it is nothing at all; the server says the same.
    const pin = String(form.postalCode || "").trim();
    if (pin && !/^\d{6}$/.test(pin)) next.postalCode = "Enter a valid 6-digit PIN code.";
    for (const [field, kind] of checks) {
      const problem = fieldError(kind, form[field]);
      if (problem) next[field] = problem;
    }
    return next;
  }

  /** The form as the server takes it: trimmed, and an empty box sent as null so it truly clears. */
  const payloadOf = (values) => {
    const text = (value) => { const trimmed = String(value ?? "").trim(); return trimmed === "" ? null : trimmed; };
    return {
      code: values.code.trim(),
      name: values.name.trim(),
      addressLine1: text(values.addressLine1),
      addressLine2: text(values.addressLine2),
      city: text(values.city),
      state: text(values.state),
      postalCode: text(values.postalCode),
      phone: text(values.phone),
      alternatePhone: text(values.alternatePhone),
      email: text(values.email),
      websiteUrl: text(values.websiteUrl),
      gstNumber: text(values.gstNumber),
      panNumber: text(values.panNumber),
      bankAccountName: text(values.bankAccountName),
      bankName: text(values.bankName),
      bankAccountNumber: text(values.bankAccountNumber),
      bankIfsc: text(values.bankIfsc),
      // Either the data URI `ImageUploadField` just made or the link this branch already holds;
      // the server tells them apart and only uploads the first. Emptied, it clears the column.
      qrCodeUrl: values.qrCodeUrl || null,
      isHeadOffice: Boolean(values.isHeadOffice),
    };
  };

  async function save() {
    /*
     * A blank box is said once, in the snackbar, rather than under every box that is blank.
     *
     * Somebody opening this form and pressing Save has nine or ten empty required boxes, and a
     * message under each turned the form into a wall of red saying the same thing ten times. The
     * asterisk beside a label already says which boxes are needed; the snackbar says the form is
     * not finished. What a *filled* box has got wrong is different — it is specific, there is
     * rarely more than one, and no snackbar can point at it — so those stay under the field.
     */
    if (anythingMissing()) {
      setErrors({});
      showError("Fill in all the mandatory fields.");
      return;
    }
    const problems = validate();
    setErrors(problems);
    if (Object.values(problems).some(Boolean)) return;

    setSaving(true);
    try {
      const payload = payloadOf(form);
      await saveBranch(payload, editing?.id);
      showSuccess(editing ? `${payload.name} updated.` : `${payload.name} added.`);
      setForm(null);
      setEditing(null);
      await load();
      /*
       * Said after the write has actually succeeded, never before it: this is what makes every
       * branch picker on the screen under this overlay re-read its list, and announcing a change
       * that the server refused would have them all fetch the same list they already hold.
       */
      branchRegistryChanged();
    } catch (error) {
      // A field the server refused is put back on the field itself; anything else is a notice.
      const fields = error?.data?.errors?.fieldErrors;
      if (fields) setErrors(Object.fromEntries(Object.entries(fields).map(([key, list]) => [key, list?.[0] || "Check this."])));
      showError(errorMessage(error, "Unable to save this branch."));
    } finally {
      setSaving(false);
    }
  }

  /** Off, or back on. The same edit either way; only the words around it differ. */
  async function confirmDisable() {
    const { branch, next } = disabling;
    setBusy(true);
    try {
      await setBranchActive(branch.id, next);
      setDisabling(null);
      showSuccess(next ? `${branch.name} is in use again.` : `${branch.name} is disabled.`);
      await load();
      // A disabled branch leaves the pickers and one put back in use returns to them, so this is
      // the same announcement a save makes.
      branchRegistryChanged();
    } catch (error) {
      showError(errorMessage(error, `Unable to ${next ? "enable" : "disable"} this branch.`));
    } finally {
      setBusy(false);
    }
  }
  const shown = useMemo(() => branchesMatchingSearch(branches, query), [branches, query]);
  const searching = Boolean(query.trim());

  const startAdd = () => { setEditing(null); setErrors({}); setForm({ ...emptyForm }); };
  const startEdit = (branch) => {
    setEditing(branch);
    setErrors({});
    setForm(Object.fromEntries(Object.entries(emptyForm).map(([key, fallback]) => [key, branch[key] ?? fallback])));
  };
  const closeForm = () => { setForm(null); setEditing(null); setConfirmHeadOffice(false); };

  /*
   * Claiming the head office is asked about before the switch moves, not after.
   *
   * It is the one switch on this form that decides something about a branch other than the one
   * being edited: there may only be ever one head office, so turning it on here takes it off
   * whoever holds it, and the person doing it may not know who that is. The dialog names them.
   *
   * Only on the way on. Turning it off takes nothing from anybody — it leaves the studio with no
   * head office, which is a state it is allowed to be in and one more switch undoes.
   */
  const headOfficeToday = branches.find((branch) => branch.isHeadOffice && branch.id !== editing?.id);
  const toggleHeadOffice = (checked) => {
    if (!checked) { update("isHeadOffice", false); return; }
    setConfirmHeadOffice(true);
  };

  return <div className="max-w-3xl">
    {/* The search takes the row on a phone and shares it from `sm` up, so the count and Add Branch
        never crowd it at 360px. */}
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="relative min-w-0 sm:max-w-xs sm:flex-1">
        <Search aria-hidden="true" style={{ fontSize: 18 }} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          aria-label="Search branches"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search name, address, GSTIN, IFSC..."
          className="h-9 w-full rounded-md border border-slate-300 bg-white pl-8 pr-2 text-sm text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
        />
      </div>
      <div className="flex items-center justify-between gap-3 sm:justify-end">
        <p className="text-xs text-slate-500 sm:text-sm">
          {loading
            ? "Loading branches..."
            : searching
              ? `${shown.length} of ${branches.length} branch${branches.length === 1 ? "" : "es"}`
              : `${branches.length} branch${branches.length === 1 ? "" : "es"}`}
        </p>
        <Button type="button" variant="primary" onClick={startAdd}>Add Branch</Button>
      </div>
    </div>

    {/* Two different empty states, because they mean different things: a register with nothing in
        it asks for a branch, and a search that found nothing says so without suggesting one. */}
    {loading ? <Loader label="Loading branches..." /> : shown.length === 0
      ? <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
        {searching ? `No branch matches "${query.trim()}".` : "No branches yet. Add one and it is offered wherever a branch is chosen."}
      </p>
      : <ul className="space-y-3">
        {shown.map((branch) => <li key={branch.id} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 sm:p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2">
                <span className="truncate text-sm font-medium text-slate-900">{branch.name}</span>
                {branch.isHeadOffice && <span className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">Head Office</span>}
                {!branch.isActive && <span className="shrink-0 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-600">Disabled</span>}
              </p>
              <p className="mt-0.5 truncate text-xs text-slate-500">{addressLineOf(branch) || "No address recorded"}</p>
            </div>
            <OptionsMenu
              ariaLabel={`Actions for ${branch.name}`}
              menuZIndexClassName={layers.menuOverPanel}
              items={[
                { label: "Edit", onSelect: () => startEdit(branch) },
                branch.isActive
                  ? { label: "Disable", tone: "danger", onSelect: () => setDisabling({ branch, next: false }) }
                  : { label: "Use Again", onSelect: () => setDisabling({ branch, next: true }) },
              ]}
            />
          </div>
          {/* A branch added before these columns existed shows dashes rather than blanks, so it is
              obvious which ones still need filling in. */}
          <dl className="mt-3 grid gap-x-4 gap-y-2 border-t border-slate-200 pt-3 sm:grid-cols-3">
            {SUMMARY_FIELDS.map(([key, label]) => <div key={key} className="min-w-0">
              <dt className="text-[11px] font-semibold text-slate-500">{label}</dt>
              <dd className="mt-0.5 truncate text-xs text-slate-800">{branch[key] || "—"}</dd>
            </div>)}
          </dl>
        </li>)}
      </ul>}

    <FloatingNotice notice={notice} onClose={clearNotice} />

    {form && <Dialog
      size="lg"
      layer="dialogOverPanel"
      title={editing ? `Edit ${editing.name}` : "Add Branch"}
      description="Everything marked with an asterisk is needed before the branch can be saved: it is what an invoice or a receipt from this branch has to carry."
      busy={saving}
      onClose={closeForm}
      /*
       * Saved by a button rather than by submitting a form.
       *
       * `Dialog` draws itself as a <form> the moment it is given an `onSubmit`, and this dialog is
       * rendered inside the Settings overlay, which is already a form. A form inside a form is not
       * something a browser will honour: the submit escaped to the outer one, which closed the whole
       * overlay and lost the half-filled branch. With no inner form there is nothing to escape.
       */
      footer={<>
        <Button className="max-sm:flex-1" type="button" onClick={closeForm} disabled={saving}>Cancel</Button>
        <Button className="max-sm:flex-1" type="button" variant="primary" onClick={() => void save()} disabled={saving}>{saving ? "Saving..." : editing ? "Update Branch" : "Add Branch"}</Button>
      </>}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Editable on an existing branch as well as a new one. Worth knowing when changing one:
            the database seed updates branches by code and the asset importer accepts a code in a
            spreadsheet's Branch column, so both go on matching the old code until they are told
            otherwise. Two branches still may not share one. */}
        <TextField required label="Branch Code" maxLength={50} value={form.code} error={errors.code} onChange={(event) => update("code", event.target.value)} placeholder="e.g. ERODE_TN" />
        <TextField required label="Branch Name" value={form.name} error={errors.name} onChange={(event) => update("name", event.target.value)} placeholder="e.g. Erode TN" />
        {/* The address in its parts rather than one box, so a document can print the city or the
            state on its own. The PIN code fills what it knows; see `fillFromPostalCode`. */}
        <TextField required className="sm:col-span-2" label="Address Line 1" value={form.addressLine1} error={errors.addressLine1} onChange={(event) => update("addressLine1", event.target.value)} placeholder="Door or building number, street, area" />
        <TextField className="sm:col-span-2" label="Address Line 2 (optional)" value={form.addressLine2} error={errors.addressLine2} onChange={(event) => update("addressLine2", event.target.value)} placeholder="Floor, landmark, anything above the street" />
        <TextField required label="Postal Code" inputMode="numeric" maxLength={6} value={form.postalCode} error={errors.postalCode} onChange={(event) => changePostalCode(event.target.value)} placeholder="6-digit PIN code" />
        <TextField required label="City" value={form.city} error={errors.city} onChange={(event) => update("city", event.target.value)} placeholder={lookingUp ? "Looking up the PIN code..." : "e.g. Erode"} />
        <TextField required className="sm:col-span-2" label="State" value={form.state} error={errors.state} onChange={(event) => update("state", event.target.value)} placeholder="e.g. Tamil Nadu" />
        {/* Two numbers, side by side and held to the same rule: the second is the landline beside
            the mobile, or whoever answers when the first does not. Both optional. */}
        <TextField required label="Phone" inputMode="tel" value={form.phone} error={errors.phone} onChange={(event) => update("phone", event.target.value)} placeholder="10-digit mobile number" />
        <TextField label="Alternate Phone" inputMode="tel" value={form.alternatePhone} error={errors.alternatePhone} onChange={(event) => update("alternatePhone", event.target.value)} placeholder="10-digit mobile number" />
        <TextField label="Email" type="email" value={form.email} error={errors.email} onChange={(event) => update("email", event.target.value)} placeholder="branch@example.com" />
        {/* Beside the email: the two are how the branch is reached, and both are optional. */}
        <TextField label="Web URL" maxLength={255} value={form.websiteUrl} error={errors.websiteUrl} onChange={(event) => update("websiteUrl", event.target.value)} placeholder="e.g. beamcraft.in" />

        <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:col-span-2">Registration</p>
        {/* Neither is required: a branch may be trading before its GSTIN comes through, and a
            studio that is not registered still has branches to bill from. Whatever is typed is
            still held to the real shape of the number. */}
        <TextField label="GSTIN" maxLength={15} value={form.gstNumber} error={errors.gstNumber} onChange={(event) => update("gstNumber", event.target.value.toUpperCase())} placeholder="33ABCDE1234F1Z5" />
        <TextField label="PAN" maxLength={10} value={form.panNumber} error={errors.panNumber} onChange={(event) => update("panNumber", event.target.value.toUpperCase())} placeholder="ABCDE1234F" />

        {/* The QR a client scans to pay this branch — the picture of what the account number below
            says in digits, which is why it sits between the two. Optional, and the same field the
            studio's logo and an asset's photograph are picked with: it compresses the picture in
            the browser, shows it back, and offers Replace and Remove. Editing a branch that has one
            shows the one it has, because the form reads the link off the branch like any other
            field. */}
        <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:col-span-2">QR Code</p>
        <ImageUploadField
          className="sm:col-span-2"
          label="Payment QR"
          value={form.qrCodeUrl}
          error={errors.qrCodeUrl}
          disabled={saving}
          accept=".jpg,.jpeg,.png,.webp"
          acceptLabel="PNG, JPG or WEBP up to 5 MB."
          onChange={(value) => update("qrCodeUrl", value || "")}
        />

        <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:col-span-2">Bank Account</p>
        <TextField required label="Account Holder Name" value={form.bankAccountName} error={errors.bankAccountName} onChange={(event) => update("bankAccountName", event.target.value)} placeholder="As printed on the passbook" />
        <TextField required label="Bank Name & Branch" value={form.bankName} error={errors.bankName} onChange={(event) => update("bankName", event.target.value)} placeholder="e.g. Union Bank — Erode" />
        <TextField required label="Account Number" inputMode="numeric" maxLength={18} value={form.bankAccountNumber} error={errors.bankAccountNumber} onChange={(event) => update("bankAccountNumber", event.target.value.replace(/\D/g, ""))} placeholder="9 to 18 digits" />
        <TextField required label="IFSC" maxLength={11} value={form.bankIfsc} error={errors.bankIfsc} onChange={(event) => update("bankIfsc", event.target.value.toUpperCase())} placeholder="SBIN0001234" />

        {/* Stated rather than left to be inferred: the head office is a claim only one branch may
            make, and the warning below says what saving it will take away from. */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-slate-200 pt-4 sm:col-span-2">
          <ToggleSwitch label="Head office" checked={form.isHeadOffice} onCheckedChange={toggleHeadOffice} />
        </div>
        {form.isHeadOffice && headOfficeToday
          && <p className="text-[11px] text-amber-700 sm:col-span-2">{headOfficeToday.name} is the head office today. Saving this moves it here.</p>}
      </div>
    </Dialog>}

    {/* Above the form it was opened from: same layer, rendered after it, as the confirmation is. */}
    {form && confirmHeadOffice && <Dialog
      layer="dialogOverPanel"
      title={`Make ${form.name.trim() || "this branch"} the head office?`}
      description={headOfficeToday
        ? `${headOfficeToday.name} is the head office today. Saving this moves it here, and ${headOfficeToday.name} stops being it — only one branch may be the head office.`
        : "No branch is the head office at the moment. Saving this makes it this one."}
      onClose={() => setConfirmHeadOffice(false)}
      footer={<>
        <Button className="max-sm:flex-1" type="button" onClick={() => setConfirmHeadOffice(false)}>Cancel</Button>
        <Button className="max-sm:flex-1" type="button" variant="primary" onClick={() => { update("isHeadOffice", true); setConfirmHeadOffice(false); }}>Make Head Office</Button>
      </>}
    />}

    {disabling && <Dialog
      layer="dialogOverPanel"
      title={disabling.next ? `Use ${disabling.branch.name} again?` : `Disable ${disabling.branch.name}?`}
      description={disabling.next
        ? "It goes back to being offered wherever a branch is chosen."
        : "It stops being offered wherever a branch is chosen, and gives up the head office if it holds it. Nothing is deleted: every user, asset and past record that belongs to this branch keeps it, and it can be used again at any time."}
      busy={busy}
      onClose={() => setDisabling(null)}
      footer={<>
        <Button className="max-sm:flex-1" type="button" onClick={() => setDisabling(null)} disabled={busy}>Cancel</Button>
        <Button className="max-sm:flex-1" type="button" variant={disabling.next ? "primary" : "danger"} onClick={confirmDisable} disabled={busy}>
          {busy ? "Saving..." : disabling.next ? "Use Again" : "Disable Branch"}
        </Button>
      </>}
    />}
  </div>;
}
