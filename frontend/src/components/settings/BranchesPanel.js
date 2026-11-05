"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Search from "@mui/icons-material/Search";
import Button from "@/components/shared/Button";
import LabelledLinksField from "@/components/shared/LabelledLinksField";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import ImageUploadField from "@/components/shared/ImageUploadField";
import Loader from "@/components/shared/Loader";
import RepeatableTextField from "@/components/shared/RepeatableTextField";
import TextField from "@/components/shared/TextField";
import ToggleSwitch from "@/components/shared/ToggleSwitch";
import Dialog from "@/components/ui/Dialog";
import OptionsMenu from "@/components/ui/OptionsMenu";
import { layers } from "@/constants/layers";
import { fieldError } from "@/constants/fieldValidation";
import { branchesMatchingSearch } from "@/lib/branchName";
import { markedFieldsMessage } from "@/lib/formErrors.mjs";
import { LINK_MESSAGE, LINK_PATTERN, linkListErrors, linkListOf, linkListPayload } from "@/lib/labelledLinks.mjs";
import { MAX_UPI_IDS, upiIdsOf } from "@/lib/upiIds.mjs";
import RepeatableDetailsField from "@/components/shared/RepeatableDetailsField";
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
 * how to reach it, its social media links, what it is registered as (GSTIN and PAN) and where it banks. All of it optional,
 * because a studio fills a branch in over time and a half-finished branch still has to be usable.
 *
 * Two rules are the server's, not this screen's, and it only reflects them: exactly one branch may
 * be the head office, and a branch that anything still points at is closed rather than deleted.
 *
 * Reached only with ADMIN / System Settings write — the same permission that decides whether the
 * Organization section appears at all, and the same one the endpoints behind this check again.
 */

/*
 * The accounts come **before** `emptyForm`, which is not a matter of taste: that object calls
 * `blankAccount()` as this module is evaluated, and a `const` does not exist until its own line has
 * run. Declared after it, the form threw "Cannot access 'ACCOUNT_FIELD_NAMES' before
 * initialization" on import - and since the settings overlay is reached from the app shell, that
 * took down every signed-in page rather than this panel alone. `blankAccount` being a hoisted
 * function declaration is what made it look safe; what runs early is the call, not the definition.
 */
/**
 * One account, as the form holds it. The four fields a transfer needs and nothing else.
 *
 * All four are asked for on every row, which is the rule the branch's own four columns enforced
 * before they became a list: an account missing any of them is a payment card a client cannot use,
 * and they would try. The formats are `fieldValidation`'s, the same table the GSTIN and the PAN are
 * checked against, so an account number is an account number everywhere in this application.
 */
const accountFields = [
  { name: "accountHolderName", label: "Account Holder Name", required: true, props: { placeholder: "As printed on the passbook" }, helperText: "The name the bank holds this account under." },
  { name: "bankName", label: "Bank Name & Branch", required: true, props: { placeholder: "e.g. Union Bank — Erode" }, helperText: "Printed on the account card the client pays from." },
  { name: "accountNumber", label: "Account Number", required: true, normalize: (value) => String(value ?? "").replace(/\D/g, "").slice(0, 18), props: { inputMode: "numeric", maxLength: 18, placeholder: "9 to 18 digits" }, helperText: "Digits only; an account number can belong to just one branch." },
  { name: "ifscCode", label: "IFSC", required: true, normalize: (value) => String(value ?? "").toUpperCase().slice(0, 11), props: { maxLength: 11, placeholder: "SBIN0001234" }, helperText: "The 11-character code of the bank branch holding the account." },
];
const ACCOUNT_FIELD_NAMES = accountFields.map((field) => field.name);

/** A row the form has just added: every box blank, nothing assumed. */
function blankAccount() {
  return Object.fromEntries(ACCOUNT_FIELD_NAMES.map((name) => [name, ""]));
}

/** Whether a row has nothing in it at all, which is a row nobody has started rather than a bad one. */
const accountIsBlank = (account = {}) => ACCOUNT_FIELD_NAMES.every((name) => !String(account[name] ?? "").trim());

/** An empty form: a branch is a name and nothing else until somebody fills the rest in. */
const emptyForm = {
  code: "", name: "", addressLine1: "", addressLine2: "", city: "", state: "", postalCode: "",
  phone: "", alternatePhone: "", email: "", websiteUrl: "", locationUrl: "",
  googleReviewUrl: "",
  // Which External URLs are shown, in the order they were added: the screen's, never sent.
  externalShown: [],
  // The social media links the studio adds and names, each `{ label, url }`.
  customSocialLinks: [],
  gstNumber: "", panNumber: "",
  qrCodeUrl: "",
  // One blank account, never none: a branch has to be payable, so the first row is the field
  // itself and Add Account is how the studio says there is another.
  bankAccounts: [blankAccount()],
  // One empty box, never none: the first is the field, and the studio adds the rest as it needs them.
  upiIds: [""],
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

/**
 * The External URLs a branch may have, each its own column, in the order the dropdown offers them.
 * None is a fixed box: each is added from "+ Add external URL", shown as a row while it holds a link,
 * and taken off with its delete button.
 */
const EXTERNAL_URLS = [
  ["websiteUrl", "Web URL"],
  ["locationUrl", "Location URL"],
  ["googleReviewUrl", "Review Link"],
];
const externalLabelOf = (field) => EXTERNAL_URLS.find(([key]) => key === field)?.[1] || field;
const externalFieldOf = (label) => EXTERNAL_URLS.find(([, name]) => name === label)?.[0] || null;

/**
 * The External URLs held to the social media links' rule - only http(s) ahead of the address. The
 * Web URL keeps its own, looser one (`validate`).
 */
const EXTERNAL_LINKS = [
  ["locationUrl", "Location URL"],
  ["googleReviewUrl", "Review Link"],
];

/** What each row shows under the name, in the order it is read. */
const SUMMARY_FIELDS = [
  ["gstNumber", "GSTIN"],
  ["panNumber", "PAN"],
  ["phone", "Phone"],
  ["alternatePhone", "Alternate Phone"],
  ["email", "Email"],
  ["websiteUrl", "Website"],
];

/**
 * The accounts under each row: the bank and the number, one line each.
 *
 * Every account rather than only the first, because which of them a branch is paid into is the kind
 * of thing somebody opens this register to check - and a register that showed one of three would be
 * answering that question wrongly. The holder and the IFSC are left to the form: they are the same
 * on every account of one studio, so printing them here says the same thing three times.
 */
const accountLinesOf = (branch) => (Array.isArray(branch.bankAccounts) ? branch.bankAccounts : [])
  .map((account) => [account.bankName, account.accountNumber].map((part) => String(part ?? "").trim()).filter(Boolean).join(" · "))
  .filter(Boolean);

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
 * Each with the message said under its box when it is left blank — see `save`.
 *
 * Left out on purpose: the second address line, the alternate phone and the email. Each is a
 * second way to say something the branch already says.
 *
 * And the GSTIN and the PAN, which used to be on this list. A branch is not always a registration —
 * a new place trades before its GSTIN comes through — so a branch is now saveable without them.
 * What is typed into either box is still checked, in `validate`: an invalid GSTIN is refused, a
 * missing one is not. The server's list matches, field for field.
 */
const REQUIRED_FIELDS = {
  code: "Enter the branch code.",
  name: "Enter the branch name.",
  addressLine1: "Enter the address.",
  postalCode: "Enter the PIN code.",
  city: "Enter the city.",
  state: "Enter the state.",
  phone: "Enter the phone number.",
};

/** How many boxes are marked, for the line above them: a list counts each box it marks. */
const markedCount = (value) => (!value ? 0 : typeof value === "object" ? Object.values(value).reduce((sum, inner) => sum + markedCount(inner), 0) : 1);


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

  /**
   * The accounts, with the errors of the rows that changed dropped and the rest left standing.
   *
   * Clearing the whole field - which is what `update` does, and what every other field here wants -
   * wiped the message on every *other* row as soon as somebody typed in one of them: three rows
   * refused and one correction, and the other two faults vanished without being fixed. So a row's
   * errors go when that row is edited, and a row nobody touched keeps what it was told.
   */
  const updateAccounts = (next) => {
    const before = form?.bankAccounts || [];
    // The list's own message is about there being no account at all, so the first thing typed into
    // one answers it.
    setErrors((current) => (current.bankAccountsList ? { ...current, bankAccountsList: "" } : current));
    setErrors((current) => {
      const rows = current.bankAccounts;
      if (!rows || typeof rows !== "object") return current;
      /*
       * A row still says what it was told while it is **the same row**: the control replaces the row
       * it edits, so identity is what distinguishes a row somebody has corrected from one they have
       * not touched. A row that was edited, moved or removed has nothing left to say about it.
       */
      return { ...current, bankAccounts: Object.fromEntries(Object.entries(rows).filter(([index]) => {
        const position = Number(index);
        return before[position] && before[position] === next[position];
      })) };
    });
    setForm((current) => ({ ...current, bankAccounts: next }));
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
  /** What a branch must have and has been left blank, each said under its own box. */
  const missing = () => ({
    ...Object.fromEntries(Object.entries(REQUIRED_FIELDS).filter(([field]) => !String(form[field] ?? "").trim())),
    // And one account it can be paid into - said under the list, since no box in it is at fault yet.
    ...((form.bankAccounts || []).some((account) => !accountIsBlank(account)) ? {} : { bankAccountsList: "Add the account this branch is paid into." }),
  });

  function validate() {
    const next = {};
    const checks = [["gstNumber", "gstin"], ["panNumber", "pan"], ["email", "email"], ["phone", "phone"], ["alternatePhone", "phone"]];
    // Loosely, and only if there is something there: enough to catch a sentence typed into the
    // box, not enough to argue with a real address. The server checks the same shape.
    const site = String(form.websiteUrl || "").trim();
    if (site && !/^(https?:\/\/)?[^\s/?#]+\.[^\s]*$/i.test(site)) next.websiteUrl = "Enter a valid web address, for example beamcraft.in.";
    // The fixed links: loose, but only http(s) ahead of the address - the server's rule too.
    for (const [field] of EXTERNAL_LINKS) {
      const link = String(form[field] || "").trim();
      if (link && !LINK_PATTERN.test(link)) next[field] = LINK_MESSAGE;
    }
    // The added links are checked like the others, and one emptied is said, not saved as a bare label.
    const socialErrors = linkListErrors(form.customSocialLinks);
    if (socialErrors.some(Boolean)) next.customSocialLinks = socialErrors;
    // A PIN code is six digits or it is nothing at all; the server says the same.
    const pin = String(form.postalCode || "").trim();
    if (pin && !/^\d{6}$/.test(pin)) next.postalCode = "Enter a valid 6-digit PIN code.";
    for (const [field, kind] of checks) {
      const problem = fieldError(kind, form[field]);
      if (problem) next[field] = problem;
    }
    /*
     * The UPI IDs, judged one box at a time so a fault is shown under the box that holds it.
     *
     * A blank box says nothing - it is a row nobody used. A repeat is said on the box that repeats
     * rather than on the one that came first, because the first is the one the studio meant.
     */
    const seenUpi = new Set();
    const upiErrors = (form.upiIds || []).map((value) => {
      const id = String(value ?? "").trim();
      if (!id) return "";
      const problem = fieldError("upi", id);
      if (problem) return problem;
      const key = id.toLowerCase();
      if (seenUpi.has(key)) return "This UPI ID is already listed.";
      seenUpi.add(key);
      return "";
    });
    if (upiErrors.some(Boolean)) next.upiIds = upiErrors;

    /*
     * The accounts, judged a row at a time so a fault is shown in the box that holds it.
     *
     * Every box of a row is asked for, because an account missing one of them cannot be paid into -
     * but a row with nothing in it at all is a row nobody started, and `missing` is what says the
     * branch needs an account. A number another *branch* holds is the server's to
     * catch, and it answers in this same shape.
     */
    const accounts = form.bankAccounts || [];
    const rowErrors = {};
    const seenNumbers = new Set();
    accounts.forEach((account, index) => {
      if (accountIsBlank(account)) return;
      const row = {};
      for (const field of accountFields) {
        if (!String(account[field.name] ?? "").trim()) row[field.name] = `${field.label} is required.`;
      }
      const number = String(account.accountNumber ?? "").trim();
      const ifsc = String(account.ifscCode ?? "").trim();
      if (number && !row.accountNumber) row.accountNumber = fieldError("accountNumber", number) || "";
      if (ifsc && !row.ifscCode) row.ifscCode = fieldError("ifsc", ifsc) || "";
      // Said on the row that repeats rather than on the one that came first, which is the one the
      // studio meant - the same way a repeated UPI ID is reported above.
      if (number && seenNumbers.has(number)) row.accountNumber = "This account number is already listed.";
      else if (number) seenNumbers.add(number);
      const real = Object.fromEntries(Object.entries(row).filter(([, message]) => message));
      if (Object.keys(real).length) rowErrors[index] = real;
    });
    if (Object.keys(rowErrors).length) next.bankAccounts = rowErrors;
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
      ...Object.fromEntries(EXTERNAL_LINKS.map(([field]) => [field, text(values[field])])),
      customSocialLinks: linkListPayload(values.customSocialLinks),
      gstNumber: text(values.gstNumber),
      panNumber: text(values.panNumber),
      /*
       * The accounts in the order they are shown, which is the order they are stored in and the
       * order the client's payment page prints them in. Blank rows are dropped rather than sent: a
       * row nobody filled in is not an account, and `key` is the list control's own bookkeeping.
       */
      bankAccounts: (values.bankAccounts || [])
        .filter((account) => !accountIsBlank(account))
        .map((account) => Object.fromEntries(ACCOUNT_FIELD_NAMES.map((name) => [name, String(account[name] ?? "").trim()]))),
      // Either the data URI `ImageUploadField` just made or the link this branch already holds;
      // the server tells them apart and only uploads the first. Emptied, it clears the column.
      qrCodeUrl: values.qrCodeUrl || null,
      upiIds: upiIdsOf(values.upiIds),
      isHeadOffice: Boolean(values.isHeadOffice),
    };
  };

  async function save() {
    // A blank required box and a filled one with the wrong shape are both said under the box; the
    // top of the form says only how many there are.
    const problems = { ...validate(), ...missing() };
    setErrors(problems);
    if (markedCount(problems)) return;

    setSaving(true);
    try {
      const payload = payloadOf(form);
      const saved = await saveBranch(payload, editing?.id);
      // The server says when a rename reached the records filed under the branch - "Branch renamed,
      // and updated on 12 records that used it." - and that is the line worth showing over a plain
      // "updated", because it is the part nobody would otherwise know had happened.
      showSuccess(saved?.message || (editing ? `${payload.name} updated.` : `${payload.name} added.`));
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
      /*
       * One message per field, which is what every field here shows - except a list, whose own
       * errors are one message per box. A message the server sends about the *list* (its length,
       * say) is not a message about any one box, so it is kept whole under the field's name rather
       * than handed to the boxes, which would read a string as one letter each.
       */
      /*
       * The accounts are a third shape again: `{ [row]: { [field]: message } }`, which is what the
       * register answers when a number belongs to another branch and what the repeated form draws
       * its per-box errors from. Taken as "one message per field" it was flattened to a string, and
       * a string indexed per row gives one letter each - so the one error this change exists to
       * report landed on no row at all.
       */
      if (fields) {
        setErrors(Object.fromEntries(Object.entries(fields).map(([key, list]) => {
          if (key === "bankAccounts") return [key, list && typeof list === "object" && !Array.isArray(list) ? list : {}];
          return [key, key === "upiIds" || key === "customSocialLinks" ? { list: list?.[0] || "Check this." } : list?.[0] || "Check this."];
        })));
        return;
      }
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

  // With no head office yet, the branch being added has to be it - so it starts on.
  const startAdd = () => { setEditing(null); setErrors({}); setForm({ ...emptyForm, isHeadOffice: !branches.some((branch) => branch.isHeadOffice) }); };
  const startEdit = (branch) => {
    setEditing(branch);
    setErrors({});
    const values = Object.fromEntries(Object.entries(emptyForm).map(([key, fallback]) => [key, branch[key] ?? fallback]));
    /*
     * Exactly the UPI IDs the branch holds, and one empty box where it holds none - never a spare
     * box under the ones it has. A branch keeping three opens on three; a branch keeping none opens
     * on one to type in, which is the same field a new branch opens on.
     */
    const saved = upiIdsOf(branch.upiIds);
    // The accounts it holds, and one blank row where it holds none - the same row a new branch
    // opens on, rather than a spare row under the ones it has.
    const accounts = (Array.isArray(branch.bankAccounts) ? branch.bankAccounts : [])
      .map((account) => Object.fromEntries(ACCOUNT_FIELD_NAMES.map((name) => [name, String(account[name] ?? "")])));
    setForm({
      ...values,
      upiIds: saved.length ? saved : [""],
      bankAccounts: accounts.length ? accounts : [blankAccount()],
      externalShown: EXTERNAL_URLS.map(([field]) => field).filter((field) => String(branch[field] || "").trim()),
      customSocialLinks: linkListOf(branch.customSocialLinks),
    });
  };
  const closeForm = () => { setForm(null); setEditing(null); setConfirmHeadOffice(false); };

  /*
   * The External URLs as the rows `LabelledLinksField` draws, and back. A row is one of the three
   * columns; removing it empties that column, so the branch saves without it.
   */
  const externalRows = (form?.externalShown || []).map((field) => ({ label: externalLabelOf(field), url: form[field] || "" }));
  const updateExternal = (rows) => {
    const shown = rows.map((row) => externalFieldOf(row.label)).filter(Boolean);
    setForm((current) => ({
      ...current,
      externalShown: shown,
      ...Object.fromEntries(EXTERNAL_URLS.map(([field]) => [field, rows.find((row) => externalFieldOf(row.label) === field)?.url ?? ""])),
    }));
    setErrors((current) => ({ ...current, ...Object.fromEntries(EXTERNAL_URLS.map(([field]) => [field, undefined])) }));
  };

  /** An added-links list changed: the form takes it, and what was said about the list is cleared. */
  const updateLinks = (key) => (links) => {
    setForm((current) => ({ ...current, [key]: links }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  /*
   * Claiming the head office is asked about before the switch moves, not after.
   *
   * It is the one switch on this form that decides something about a branch other than the one
   * being edited: there may only be ever one head office, so turning it on here takes it off
   * whoever holds it, and the person doing it may not know who that is. The dialog names them.
   *
   * There is always one head office - the payslip prints its address. So the switch is locked on for
   * the branch that is it (it moves by another branch becoming it), and for a branch being added while
   * there is none.
   */
  const headOfficeToday = branches.find((branch) => branch.isHeadOffice && branch.id !== editing?.id);
  const isTheHeadOffice = Boolean(editing?.isHeadOffice);
  const mustBeHeadOffice = isTheHeadOffice || !branches.some((branch) => branch.isHeadOffice);
  const toggleHeadOffice = (checked) => {
    if (!checked) { if (!mustBeHeadOffice) update("isHeadOffice", false); return; }
    if (!headOfficeToday) { update("isHeadOffice", true); return; }
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
                // The head office is never taken out of use - another branch has to become it first.
                ...(branch.isHeadOffice ? [] : [branch.isActive
                  ? { label: "Disable", tone: "danger", onSelect: () => setDisabling({ branch, next: false }) }
                  : { label: "Use Again", onSelect: () => setDisabling({ branch, next: true }) }]),
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
            {/* Every account, one line each, because which accounts a branch is paid into is a
                question somebody opens this register to answer - and showing one of three would
                answer it wrongly. A dash where a branch has none, like the fields beside it. */}
            <div className="min-w-0 sm:col-span-3">
              <dt className="text-[11px] font-semibold text-slate-500">
                {accountLinesOf(branch).length > 1 ? `Bank Accounts (${accountLinesOf(branch).length})` : "Bank Account"}
              </dt>
              {accountLinesOf(branch).length
                ? accountLinesOf(branch).map((line) => (
                  <dd key={line} className="mt-0.5 truncate text-xs text-slate-800">{line}</dd>
                ))
                : <dd className="mt-0.5 truncate text-xs text-slate-800">—</dd>}
            </div>
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
        {markedCount(errors) > 0 && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 sm:col-span-2">{markedFieldsMessage(markedCount(errors))}</p>}
        {/* Editable on an existing branch as well as a new one. Worth knowing when changing one:
            the database seed updates branches by code and the asset importer accepts a code in a
            spreadsheet's Branch column, so both go on matching the old code until they are told
            otherwise. Two branches still may not share one. */}
        <TextField required label="Branch Code" maxLength={50} value={form.code} error={errors.code} onChange={(event) => update("code", event.target.value)} placeholder="e.g. ERODE_TN" helperText="A short unique code; imports and the seed match branches by it." />
        <TextField required label="Branch Name" value={form.name} error={errors.name} onChange={(event) => update("name", event.target.value)} placeholder="e.g. Erode TN" helperText="Shown wherever a branch is chosen and on its documents." />
        {/* The address in its parts rather than one box, so a document can print the city or the
            state on its own. The PIN code fills what it knows; see `fillFromPostalCode`. */}
        <TextField required className="sm:col-span-2" label="Address Line 1" value={form.addressLine1} error={errors.addressLine1} onChange={(event) => update("addressLine1", event.target.value)} placeholder="Door or building number, street, area" helperText="The first address line printed on this branch's invoices and receipts." />
        <TextField className="sm:col-span-2" label="Address Line 2 (optional)" value={form.addressLine2} error={errors.addressLine2} onChange={(event) => update("addressLine2", event.target.value)} placeholder="Floor, landmark, anything above the street" helperText="Printed under the first line; leave empty if not needed." />
        <TextField required label="Postal Code" inputMode="numeric" maxLength={6} value={form.postalCode} error={errors.postalCode} onChange={(event) => changePostalCode(event.target.value)} placeholder="6-digit PIN code" helperText="Typing all six digits fills City and State when they are empty." />
        <TextField required label="City" value={form.city} error={errors.city} onChange={(event) => update("city", event.target.value)} placeholder={lookingUp ? "Looking up the PIN code..." : "e.g. Erode"} helperText="Filled from the PIN code; change it if it reads wrong." />
        <TextField required className="sm:col-span-2" label="State" value={form.state} error={errors.state} onChange={(event) => update("state", event.target.value)} placeholder="e.g. Tamil Nadu" helperText="Filled from the PIN code; printed with the address." />
        {/* Two numbers, side by side and held to the same rule: the second is the landline beside
            the mobile, or whoever answers when the first does not. Both optional. */}
        <TextField required label="Phone" inputMode="tel" value={form.phone} error={errors.phone} onChange={(event) => update("phone", event.target.value)} placeholder="10-digit mobile number" helperText="The branch's main contact number for clients." />
        <TextField label="Alternate Phone" inputMode="tel" value={form.alternatePhone} error={errors.alternatePhone} onChange={(event) => update("alternatePhone", event.target.value)} placeholder="10-digit mobile number" helperText="Optional second number, for when the main one is not answered." />
        <TextField className="sm:col-span-2" label="Email" type="email" value={form.email} error={errors.email} onChange={(event) => update("email", event.target.value)} placeholder="branch@example.com" helperText="Optional address clients can write to about this branch." />

        {/* Where the branch is found on the web: its own site, its place on a map and its Google
            reviews. All optional, each added from a dropdown of the three and removable. */}
        <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:col-span-2">External URLs</p>
        <LabelledLinksField
          links={externalRows}
          onChange={updateExternal}
          errors={(form.externalShown || []).map((field) => errors[field] || "")}
          disabled={saving}
          addLabel="+ Add external URL"
          dialogTitle="Add external URL"
          dialogDescription="Choose which link it is and paste its address."
          labelOptions={EXTERNAL_URLS.map(([, label]) => label)}
          linkPlaceholder="https://..."
        />

        {/* Where the branch is on social media: no fixed fields, only the links the studio adds -
            a field each, under the label it was given, with a way to take it off again. Each held to
            the same rule as the Location URL and Review Link above. */}
        <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:col-span-2">Social Media Links</p>
        <LabelledLinksField
          links={form.customSocialLinks || []}
          onChange={updateLinks("customSocialLinks")}
          errors={errors.customSocialLinks}
          disabled={saving}
          addLabel="+ Add social media link"
          dialogTitle="Add social media link"
          labelPlaceholder="e.g. YouTube"
          linkPlaceholder="https://youtube.com/@..."
        />

        <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:col-span-2">Registration</p>
        {/* Neither is required: a branch may be trading before its GSTIN comes through, and a
            studio that is not registered still has branches to bill from. Whatever is typed is
            still held to the real shape of the number. */}
        <TextField label="GSTIN" maxLength={15} value={form.gstNumber} error={errors.gstNumber} onChange={(event) => update("gstNumber", event.target.value.toUpperCase())} placeholder="33ABCDE1234F1Z5" helperText="Optional; the 15-character GST number this branch bills under." />
        <TextField label="PAN" maxLength={10} value={form.panNumber} error={errors.panNumber} onChange={(event) => update("panNumber", event.target.value.toUpperCase())} placeholder="ABCDE1234F" helperText="Optional; the 10-character PAN this branch is registered under." />

        {/* The QR a client scans to pay this branch — the picture of what the account number below
            says in digits, which is why it sits between the two. Optional, and the same field the
            studio's logo and an asset's photograph are picked with: it compresses the picture in
            the browser, shows it back, and offers Replace and Remove. Editing a branch that has one
            shows the one it has, because the form reads the link off the branch like any other
            field. */}
        <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:col-span-2">QR Code</p>
        {/* The addresses the QR encodes, as text a client can type: optional like the picture, and
            each held only to the shape every UPI ID shares (`fieldValidation`, the same table the
            IFSC and the account number are checked against). Above the picture because it is read
            first. A branch is commonly paid into more than one handle, so this is a list - one box
            to begin with, Add for the next - and the client's quotation payment page prints each
            of them beside the QR. */}
        <RepeatableTextField
          className="sm:col-span-2"
          label="UPI ID"
          addLabel="+ Add UPI ID"
          placeholder="e.g. beamcraft@upi"
          maxLength={100}
          maxRows={MAX_UPI_IDS}
          values={form.upiIds}
          error={errors.upiIds?.list || ""}
          errors={Array.isArray(errors.upiIds) ? errors.upiIds : []}
          disabled={saving}
          onChange={(next) => update("upiIds", next)}
        />
        <ImageUploadField
          className="sm:col-span-2"
          label="Payment QR"
          helperText="The QR code clients scan to pay this branch."
          value={form.qrCodeUrl}
          error={errors.qrCodeUrl}
          disabled={saving}
          accept=".jpg,.jpeg,.png,.webp"
          acceptLabel="PNG, JPG or WEBP up to 5 MB."
          onChange={(value) => update("qrCodeUrl", value || "")}
        />

        {/* Every account the branch is paid into, not one. The studio adds the next with Add
            Account, and the order is the studio's: the first is the account it leads with, and it is
            the order the client's quotation payment page prints the cards in. All four boxes are
            asked for on each row - an account missing one cannot be paid into, and a client handed
            such a card would try. `RepeatableDetailsField` is the control the employee form adds
            children and qualifications with, so Add, Remove, the empty state and the per-box errors
            are the ones this application already uses. */}
        <RepeatableDetailsField
          className="sm:col-span-2"
          label="Bank Accounts"
          /* Leading with the requirement, because that is the part somebody has to act on: an order
             they have not yet made a list for is not a thing they can get wrong, and a form that
             explains the order before saying an account is needed at all buries the rule it is
             enforcing. */
          helperText="At least one account, with all four details. The first is the one this branch leads with, and the client's payment page lists them in that order."
          addLabel="+ Add Account"
          emptyText="No account added yet."
          rowLabel={(index) => `Account ${index + 1}`}
          required
          fields={accountFields}
          value={form.bankAccounts}
          /* The one message that is about the **list** rather than about a box in it, which is what
             the control's own `error` is for: an empty list is not a fault any row can carry. Set by
             a refused save and never before it, like every other message on this form - a branch
             being filled in is not red from the moment it opens. */
          error={errors.bankAccountsList || ""}
          errors={errors.bankAccounts && typeof errors.bankAccounts === "object" ? errors.bankAccounts : {}}
          disabled={saving}
          onChange={updateAccounts}
        />

        {/* Stated rather than left to be inferred: the head office is a claim only one branch may
            make, and the warning below says what saving it will take away from. */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-slate-200 pt-4 sm:col-span-2">
          <ToggleSwitch label="Head office *" checked={form.isHeadOffice} disabled={mustBeHeadOffice && form.isHeadOffice} onCheckedChange={toggleHeadOffice} helperText={!mustBeHeadOffice
            ? "Only one branch can be head office; payslips print its address."
            : isTheHeadOffice
              ? "This is the head office, and there always has to be one - the payslip prints its address. To move it, turn on Head office for another branch."
              : "The studio has no head office yet, so this branch will be it - the payslip prints the head office's address."} />
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
