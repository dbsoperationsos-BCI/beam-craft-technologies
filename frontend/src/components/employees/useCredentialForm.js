"use client";

import { avatarOf } from "@/lib/employeeAvatar.mjs";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getRoles } from "@/services/admin/admin.service";
import { createLoginCredentials, getLoginCredentials, getLoginCredentialsDraft, saveLoginCredentialsDraft, updateLoginCredentials } from "@/services/hrm/employees.service";
import { getMasterData } from "@/services/hrm/master-data.service";
import RolePicker from "@/components/shared/RolePicker";
import Checkbox from "@/components/shared/Checkbox";
import MultiSelectField from "@/components/shared/MultiSelectField";
import { useNotice } from "@/components/shared/FloatingNotice";
import { loadStudioBranding } from "@/components/shared/useStudioBranding";
import useBranchRegistry from "@/components/shared/useBranchRegistry";
import { draftFrom, mergeProposals, touchedByDraft } from "./credentialDraft";
import { FALLBACK_LOGIN_EMAIL_DOMAIN, loginEmailDomain } from "@/lib/employeeName.mjs";
import { generateTemporaryPassword } from "@/lib/temporaryPassword.mjs";
import { loginIdentityProblems } from "@/lib/loginCredentials.mjs";
import { workingEmployees } from "@/lib/employmentStatus.mjs";
import EmployeeWhatsAppGroups from "@/components/employees/EmployeeWhatsAppGroups";

/**
 * Everything the Login Credentials page of onboarding needs: the account this employee signs in
 * with, what it may do, and who covers for them while they are away. Pulled out of its own dialog
 * so it can be driven from wherever an onboarding flow is at — a step of the same panel Review
 * Employee Details is, rather than a second popup that follows it.
 */


/**
 * The employee's work location is free text and a branch is a row in the locations master data, so
 * the two are matched by name. A location naming no branch leaves the account with no branch at all
 * — shown as an empty Branch in the summary — rather than the form guessing at one.
 */
function matchBranch(employee, branches) {
  const wanted = [employee?.workBaseLocation, employee?.currentWorkLocation].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean);
  const found = branches.find((branch) => wanted.includes(String(branch.name || "").trim().toLowerCase()));
  return found ? String(found.id) : "";
}


/** The same rules the API enforces, checked here so a problem is shown against its own field. */
function validate(values, { managing = false } = {}) {
  const errors = {};
  /*
   * The sign-in identity is only checked where it is being decided.
   *
   * Managing an account that already exists shows those three as facts and sends none of them, so
   * insisting on them here would refuse a save over fields the page does not have — and the first
   * of them, the password, is never even shown once an account has one.
   */
  // The rules every new sign-in shares - an employee's here, a client's on Create Project.
  if (!managing) Object.assign(errors, loginIdentityProblems(values));
  // Each alternative menu hides the other's pick, so this only catches a pair that arrived equal
  // some other way - a backstop, blamed on the second slot.
  if (values.alternative1EmployeeId && values.alternative1EmployeeId === values.alternative2EmployeeId) {
    errors.alternative2EmployeeId = "Choose someone other than Alternative 1.";
  }
  return errors;
}

/**
 * Nobody covers for themselves, and only somebody actually working here covers at all.
 *
 * It used to drop the three departed statuses by name, which let through everybody else the
 * repository holds: somebody still onboarding, somebody whose own form is not in yet, somebody on
 * long leave. Cover and leave approval are asked of a person who has to answer, so the question is
 * who is *here* rather than who has not left - see `workingEmployees`.
 */
const coverCandidates = (employees, employee) => workingEmployees(employees)
  .filter((row) => row.id !== employee?.id)
  .map((row) => ({ value: String(row.id), label: `${row.employeeName}${row.employeeId ? ` — ${row.employeeId}` : ""}`, avatar: avatarOf(row) }));

/**
 * `employee` is the record credentials are being created for — a page of onboarding cannot ask for
 * this until Review Employee Details has actually been saved, since there is no employee id to
 * create a login against before then. Pass `null` until that happens; the hook answers `ready:
 * false` and does nothing that needs one.
 */
/*
 * `departmentSignal` is the employee form's **live** department text.
 *
 * The WhatsApp Groups section offers the groups of the employee's departments, read from the saved
 * record. This page holds the employee as it was when the panel opened, so a department changed on
 * Employment Details - saved on the spot, but on another page of the same panel - never reached it:
 * the box stayed empty right after somebody had chosen departments. Handed down, a change to it
 * re-reads the groups.
 */
export default function useCredentialForm(employee, employees = [], onCreated, { manage = false, onUpdated, departmentSignal = "" } = {}) {
  const ready = Boolean(employee?.id);
  /*
   * Whether this page is issuing an account or looking after one that exists.
   *
   * Set from what the server answers rather than from the caller, because only the server knows:
   * Edit Employee opens this page for anybody, and an employee taken on before the onboarding flow
   * existed has no login to manage. `null` while that is still being asked.
   */
  const [account, setAccount] = useState(null);
  const managing = Boolean(manage && account?.userId);
  /*
   * What has been typed, which is not the same as what the fields show.
   *
   * The record these are proposed from does not exist when this hook first runs — onboarding opens
   * on Review Employee Details with nothing saved, and this page is only reachable once it is. So
   * the proposal cannot be baked into the initial state, and filling it in from an effect afterwards
   * made the fields depend on when that effect happened to fire relative to the record arriving.
   *
   * They are derived instead, below: state holds what a person has typed, and a field they have not
   * touched reads the proposal straight off the record. There is no moment at which the record is
   * present and the field is empty, because there is nothing to run in between.
   */
  /*
   * The password this page opened with, generated once and held.
   *
   * Once rather than per render, and read by the baseline below as well as by the field, for the
   * reason the domain is settled the same way: the page decides whether it has been edited by
   * comparing what it shows against what it opened as, and a password that were freshly random
   * each render would make every render an edit. Regenerating replaces what the field holds and is
   * a real change against this — which is right, and is what makes Save Draft keep it.
   */
  // A lazy initialiser rather than a ref, so it is computed exactly once and never during a render.
  const [openedWithPassword] = useState(generateTemporaryPassword);

  const [values, setValues] = useState(() => ({
    branchId: "",
    username: "",
    email: "",
    alternative1EmployeeId: "",
    alternative2EmployeeId: "",
    leaveApproverIds: [],
    permissionApproverEmployeeId: "",
    regularizationApproverEmployeeId: "",
    temporaryPassword: openedWithPassword,
    roleIds: [],
    // Off. Nobody is held to WhatsApp until an administrator ticks it on their account.
    whatsappAllowed: false,
    excludeFromAttendance: false,
    allowFlexibleShift: false,
  }));
  /*
   * Which fields the person has answered themselves. Once touched, a field is theirs — including
   * when they have deliberately emptied it, which is why this is tracked rather than inferred from
   * the value being blank.
   */
  const [touched, setTouched] = useState({});
  const [branches, setBranches] = useState([]);
  const [roles, setRoles] = useState([]);
  const [rolesError, setRolesError] = useState("");
  const [loading, setLoading] = useState(ready);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  /*
   * What is on the server, as the same JSON this page would send.
   *
   * Set once the page has finished loading — after the branch has been matched and any saved draft
   * applied — because until then "unchanged" has no meaning yet: every field is still arriving.
   * Null while that is true, which is what stops the footer offering to save a page that has not
   * finished opening.
   */
  const [savedDraft, setSavedDraft] = useState(null);
  /*
   * The domain this account's login address is issued under - Settings → Global → Login Credential
   * Name, and the shipped fallback until one is set.
   *
   * Held as state and settled with the rest of the page rather than subscribed to, for the reason
   * the baseline above exists: the proposal and the answer to "has this page changed" are the same
   * calculation, and a domain arriving a frame after that answer was worked out would change the
   * proposal underneath it and open the page offering to save itself.
   */
  const [loginDomain, setLoginDomain] = useState(FALLBACK_LOGIN_EMAIL_DOMAIN);
  const { notice, showNotice, showError, clearNotice } = useNotice();
  // Bumped when Settings → Organization → Branches saves; only the branch options below read it.
  const branchRegistryRevision = useBranchRegistry();

  useEffect(() => {
    if (!ready) return undefined;
    let live = true;
    setLoading(true);

    // Answers the branch it matched, which the baseline below needs: that `setValues` and this
    // one are batched together and neither can read the other's result.
    const loadBranches = getMasterData("branches", { active: true })
      .then((response) => {
        if (!live) return "";
        const rows = (response?.data || []).map((row) => ({ id: row.id, name: row.name }));
        setBranches(rows);
        const matched = matchBranch(employee, rows);
        if (matched) setValues((current) => (current.branchId ? current : { ...current, branchId: matched }));
        return matched;
      })
      .catch(() => { if (live) setBranches([]); return ""; });

    /*
     * The studio's domain, read the same way and at the same time as everything else on this page.
     * A failed read is not an error the page shows: the fallback domain is a working proposal and
     * the field is editable, so an unreachable branding endpoint costs a suggestion, not the form.
     */
    const loadDomain = loadStudioBranding()
      .then((branding) => loginEmailDomain(branding?.loginCredentialName))
      .catch(() => FALLBACK_LOGIN_EMAIL_DOMAIN);

    const loadRoles = getRoles()
      .then((response) => { if (live) setRoles(response?.data || []); })
      .catch((requestError) => {
        if (!live) return;
        setRolesError(requestError.status === 403
          ? "You cannot read the list of roles, so this account has to be given its roles from Administration afterwards."
          : requestError.message || "Unable to load roles.");
      });

    /*
     * The page as somebody last put it down, if they did.
     *
     * Applied over the proposals rather than beside them, and its fields marked answered, so a
     * username somebody deliberately changed is not quietly replaced by the one the name would
     * have produced. A draft nobody saved answers `null` and the page opens exactly as it always
     * did.
     *
     * A failure here is not shown. The page still works without a draft - it proposes from the
     * record - and an error banner over a form that is filled in and usable would say the wrong
     * thing. The one cost is the draft not being applied, which the next save simply overwrites.
     */
    /*
     * Managing: the account as it stands, which is the page's starting point rather than a proposal.
     *
     * Applied the way a saved draft is - values plus `touched` - because the two mean the same thing
     * here: these are answers somebody already gave, and must not be quietly replaced by the ones
     * the employee's name would have produced. Reusing that path is also what keeps `shown`,
     * `dirty` and the baseline below working unchanged.
     */
    const loadAccount = manage
      ? getLoginCredentials(employee.id)
        .then((response) => {
          if (!live) return null;
          const found = response?.data || null;
          setAccount(found);
          if (!found) return null;
          const applied = {
            username: found.username || "",
            email: found.email || "",
            branchId: found.branchId === null || found.branchId === undefined ? "" : String(found.branchId),
            roleIds: found.roleIds || [],
            whatsappAllowed: found.whatsappRequired === true,
            excludeFromAttendance: found.excludeFromAttendance === true,
            allowFlexibleShift: found.allowFlexibleShift === true,
            alternative1EmployeeId: found.alternative1EmployeeId ? String(found.alternative1EmployeeId) : "",
            alternative2EmployeeId: found.alternative2EmployeeId ? String(found.alternative2EmployeeId) : "",
            leaveApproverIds: (found.leaveApproverIds || []).map(String),
            permissionApproverEmployeeId: found.permissionApproverEmployeeId ? String(found.permissionApproverEmployeeId) : "",
            regularizationApproverEmployeeId: found.regularizationApproverEmployeeId ? String(found.regularizationApproverEmployeeId) : "",
          };
          setValues((current) => ({ ...current, ...applied }));
          setTouched((current) => ({ ...current, ...Object.fromEntries(Object.keys(applied).map((key) => [key, true])) }));
          return applied;
        })
        .catch(() => null)
      : Promise.resolve(null);

    const loadDraft = manage ? Promise.resolve(null) : getLoginCredentialsDraft(employee.id)
      .then((response) => {
        if (!live) return null;
        const draft = response?.data || null;
        if (!draft) return null;
        setValues((current) => ({ ...current, ...draftFrom({ ...current, ...draft }) }));
        setTouched((current) => ({ ...current, ...touchedByDraft(draft) }));
        return draft;
      })
      .catch(() => null);

    void Promise.all([loadBranches, loadRoles, loadDraft, loadAccount, loadDomain]).then(([matchedBranch, , draft, applied, domain]) => {
      if (!live) return;
      setLoading(false);
      // Set in the same batch as the baseline below, and read by it, so the two cannot disagree.
      setLoginDomain(domain);
      /*
       * What "unchanged" means from here on, settled the moment the page has finished arriving.
       *
       * Built from the two answers above rather than read out of state: the `setValues` calls that
       * apply them are batched with this one and none of them can see another's result. It runs the
       * same two pure functions the fields do, on the same values, so the page opens saying nothing
       * has changed - which is the whole point. Getting this wrong in either direction is visible:
       * too loose and Save Draft is offered on a page nobody touched, too tight and a real edit
       * closes without being offered.
       */
      // Managing opens on the account, so "unchanged" is the account: anything else would have the
      // page offering to save the moment it finished loading.
      if (applied) {
        setSavedDraft(JSON.stringify(draftFrom(mergeProposals(employee, { temporaryPassword: openedWithPassword, ...applied }, Object.fromEntries(Object.keys(applied).map((key) => [key, true])), domain))));
        return;
      }
      const settled = { branchId: matchedBranch || "", temporaryPassword: openedWithPassword, roleIds: [], ...(draft || {}) };
      setSavedDraft(JSON.stringify(draftFrom(mergeProposals(employee, settled, touchedByDraft(draft), domain))));
    });
    return () => { live = false; };
    // `employee` is read for its id alone here - `ready` already tracks that - and matching a
    // branch against a different one keyed on it directly would refetch on every keystroke of a
    // page 1 field bleeding through, if the caller ever passed a live-editing object rather than
    // the one just saved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, manage]);

  /*
   * The branch list on its own, when the register changes while this page is open.
   *
   * Deliberately not the effect above, which does far more than fetch branches: it settles what
   * "unchanged" means for this page, applies a saved draft and reads the account. Running that
   * again would rebuild the baseline under somebody who is halfway through filling the form in and
   * take their answers back to what the record proposes. So only the options are replaced here -
   * `values` is left exactly as it is, and a branch already chosen stays chosen even if it is the
   * one that has just been renamed, since a rename keeps the id.
   *
   * `branchRegistryRevision` is 0 until something is actually saved, which is what keeps this from
   * fetching the same list the effect above has just fetched.
   */
  useEffect(() => {
    if (!ready || !branchRegistryRevision) return undefined;
    let live = true;
    getMasterData("branches", { active: true })
      .then((response) => { if (live) setBranches((response?.data || []).map((row) => ({ id: row.id, name: row.name }))); })
      // Left as it was: a refresh that fails is not a reason to empty a picker that is working.
      .catch(() => {});
    return () => { live = false; };
  }, [ready, branchRegistryRevision]);

  const change = useCallback((name, value) => {
    setValues((current) => ({ ...current, [name]: value }));
    setTouched((current) => (current[name] ? current : { ...current, [name]: true }));
    setErrors((current) => (current[name] ? { ...current, [name]: "" } : current));
  }, []);

  /*
   * The form as it reads on screen: what was typed where something was, and what the record
   * proposes everywhere else. This is what the fields render, what `validate` checks and what
   * `submit` sends — `values` above is only the half a person has answered.
   */
  const shown = useMemo(() => mergeProposals(employee, values, touched, loginDomain), [employee, loginDomain, touched, values]);

  /*
   * The page as it would be stored: the eight answers, and nothing derived from them.
   *
   * Read from `shown` rather than from `values`, so a draft records what the page actually said —
   * a username nobody retyped is still the username this account is about to be created under, and
   * a draft that left it out would restore a blank field.
   */
  const draftPayload = useMemo(() => draftFrom(shown), [shown]);

  const dirty = savedDraft !== null && JSON.stringify(draftPayload) !== savedDraft;

  const selectedRoles = useMemo(() => shown.roleIds.map((id) => roles.find((role) => role.id === id)).filter(Boolean), [roles, shown.roleIds]);
  /*
   * Whether the roles on this page make the person a Super Admin.
   *
   * Handed back so the *record* page can stop insisting on a Reports To for them - the top of the
   * org chart reports to nobody. It is read from the page rather than only from the saved account
   * so that an administrator can be created in one pass: the role is ticked here, and Employment
   * Details stops asking for a manager straight away rather than after a save that refused.
   *
   * By name, because that is what the system role is: `SUPER_ADMIN` is seeded `isSystem` and
   * Administration → Roles refuses to rename it.
   */
  const superAdminSelected = useMemo(() => selectedRoles.some((role) => role?.name === "SUPER_ADMIN"), [selectedRoles]);
  const branchName = branches.find((branch) => String(branch.id) === shown.branchId)?.name || "";

  /**
   * Puts the page down as it stands, so it is there next time.
   *
   * Nothing is validated and nothing is created: a draft is unfinished by definition, and refusing
   * to keep a half-filled page until it was correct would defeat the point of keeping it. The
   * account is still made only by **Create User & Send Email**, under the full rules.
   *
   * Answers whether it saved, because the caller closes the panel on the strength of it — closing
   * on a save that failed is how the work would be lost by the one control offering to keep it.
   */
  const saveDraft = useCallback(async () => {
    // A draft is a page on its way to creating an account. There is nothing to put down once the
    // account exists - the page saves or it does not.
    if (!ready || managing) return false;
    setSaving(true);
    setError("");
    try {
      await saveLoginCredentialsDraft(employee.id, draftPayload);
      setSavedDraft(JSON.stringify(draftPayload));
      return true;
    } catch (requestError) {
      setError(requestError.data?.message || requestError.message || "Unable to save this page as a draft.");
      return false;
    } finally {
      setSaving(false);
    }
  }, [draftPayload, employee, managing, ready]);

  async function submit(event) {
    event.preventDefault();
    if (!ready) return;
    const found = validate(shown, { managing });
    setErrors(found);
    if (Object.keys(found).length) {
      setError("Check the fields marked in red.");
      return;
    }

    setError("");
    setSaving(true);
    /*
     * Managing an account changes what it may do and who covers the person, and sends nothing else.
     *
     * The username, email and password the page is showing are not in this payload and the endpoint
     * would not take them: an identity is Admin -> User Management's to change.
     *
     * `onUpdated` rather than `onCreated`, because the two are not the same event and the caller
     * says different things about them: nothing was created, no email was sent, and an account whose
     * roles were just changed has not moved anybody to the Active tab.
     */
    if (managing) {
      try {
        await updateLoginCredentials(employee.id, {
          roleIds: shown.roleIds,
          whatsappRequired: shown.whatsappAllowed === true,
          excludeFromAttendance: shown.excludeFromAttendance === true,
          allowFlexibleShift: shown.allowFlexibleShift === true,
          alternative1EmployeeId: shown.alternative1EmployeeId ? Number(shown.alternative1EmployeeId) : null,
          alternative2EmployeeId: shown.alternative2EmployeeId ? Number(shown.alternative2EmployeeId) : null,
          leaveApprover1EmployeeId: shown.leaveApproverIds[0] ? Number(shown.leaveApproverIds[0]) : null,
          leaveApprover2EmployeeId: shown.leaveApproverIds[1] ? Number(shown.leaveApproverIds[1]) : null,
          leaveApprover3EmployeeId: shown.leaveApproverIds[2] ? Number(shown.leaveApproverIds[2]) : null,
          permissionApproverEmployeeId: shown.permissionApproverEmployeeId ? Number(shown.permissionApproverEmployeeId) : null,
          regularizationApproverEmployeeId: shown.regularizationApproverEmployeeId ? Number(shown.regularizationApproverEmployeeId) : null,
        });
        setSavedDraft(JSON.stringify(draftPayload));
        await onUpdated?.();
      } catch (requestError) {
        setError(requestError.data?.message || requestError.message || "Unable to update the login credentials.");
      } finally {
        setSaving(false);
      }
      return;
    }
    try {
      const response = await createLoginCredentials(employee.id, {
        email: shown.email.trim(),
        username: shown.username.trim(),
        temporaryPassword: shown.temporaryPassword,
        branchId: shown.branchId ? Number(shown.branchId) : null,
        roleIds: shown.roleIds,
        whatsappRequired: shown.whatsappAllowed === true,
        excludeFromAttendance: shown.excludeFromAttendance === true,
        allowFlexibleShift: shown.allowFlexibleShift === true,
        alternative1EmployeeId: shown.alternative1EmployeeId ? Number(shown.alternative1EmployeeId) : null,
        alternative2EmployeeId: shown.alternative2EmployeeId ? Number(shown.alternative2EmployeeId) : null,
        leaveApprover1EmployeeId: shown.leaveApproverIds[0] ? Number(shown.leaveApproverIds[0]) : null,
        leaveApprover2EmployeeId: shown.leaveApproverIds[1] ? Number(shown.leaveApproverIds[1]) : null,
        leaveApprover3EmployeeId: shown.leaveApproverIds[2] ? Number(shown.leaveApproverIds[2]) : null,
        permissionApproverEmployeeId: shown.permissionApproverEmployeeId ? Number(shown.permissionApproverEmployeeId) : null,
        regularizationApproverEmployeeId: shown.regularizationApproverEmployeeId ? Number(shown.regularizationApproverEmployeeId) : null,
      });
      setResult(response);
      /*
       * The password travels with the response, because the response does not carry it.
       *
       * The server never sends a password back — quite right — so this is the only moment anybody
       * holds all three details at once. The screen that shows them for hand-over is the page, not
       * this panel, since the panel closes the instant onboarding finishes.
       */
      await onCreated?.(response, shown.temporaryPassword);
    } catch (requestError) {
      setError(requestError.data?.message || requestError.message || "Unable to create login credentials.");
    } finally {
      setSaving(false);
    }
  }

  const candidates = useMemo(() => coverCandidates(employees, employee), [employees, employee]);

  const context = useMemo(() => ({
    options: {
      alternative1Options: [{ value: "", label: "No alternative" }, ...candidates.filter((candidate) => candidate.value !== shown.alternative2EmployeeId)],
      alternative2Options: [{ value: "", label: "No alternative" }, ...candidates.filter((candidate) => candidate.value !== shown.alternative1EmployeeId)],
      /*
       * People, and only people - what happens with nobody chosen is the field's placeholder.
       *
       * `coverCandidates` is the same list the alternatives and the leave approvers are picked
       * from: everybody actually working here, minus this employee. Nobody who has left, nobody
       * still an invitation, and nobody who could not answer if they were asked.
       *
       * No exclusions beyond those. Unlike the two alternative slots, which hide whoever the other
       * one names, there is nothing here to collide with: one slot cannot hold a person twice, and
       * naming the same manager here and among the leave approvers is the ordinary case rather than
       * a mistake to prevent.
       */
      permissionApproverOptions: candidates,
      // The same colleagues: anybody but the person themselves may decide their regularizations.
      regularizationApproverOptions: candidates,
    },
    renderers: {
      leaveApproverIds: () => <MultiSelectField
        label="Leave Approvers"
        placeholder="Select up to 3 approvers"
        searchable
        options={candidates}
        values={shown.leaveApproverIds}
        onChange={(next) => {
          if (next.length > 3) {
            showNotice("You can only select up to 3 employees as leave approvers.");
            return;
          }
          change("leaveApproverIds", next);
        }}
        helperText={shown.leaveApproverIds.length
          ? `${shown.leaveApproverIds.length} of 3 selected — approval is asked in the order they were picked.`
          : "Pick up to 3 approvers, in the order their approval is asked for."}
      />,
      /*
       * The sign-in identity of an account that exists, stated rather than offered.
       *
       * Facts, in the same label-over-value shape a panel states the record it is acting on with -
       * not disabled boxes, which read as fields somebody has closed to you rather than as things
       * decided elsewhere. The password is not among them and never shows a value: what it is now is
       * not something this page knows or should say, and the line under it points at the screen that
       * can actually change one.
       */
      accountIdentity: () => <div className="grid gap-4 sm:grid-cols-2">
        {[["Username", shown.username], ["Login Email", shown.email]].map(([label, value]) => <div key={label}>
          <p className="text-[11px] font-semibold text-slate-600 sm:text-xs">{label}</p>
          <p className="mt-1.5 break-words text-sm font-medium text-slate-800">{value || "—"}</p>
        </div>)}
        <div className="sm:col-span-2">
          <p className="text-[11px] font-semibold text-slate-600 sm:text-xs">Password</p>
          <p className="mt-1.5 text-sm font-medium text-slate-800">••••••••</p>
          <p className="mt-1.5 text-xs font-normal text-slate-500">The username, email and password are what this person signs in with, and are changed in Administration → User Management. What the account may do, and who covers for them, are set below.</p>
        </div>
      </div>,
      /*
       * One password per account, and a way to ask for another.
       *
       * Read-only rather than typed: the point of generating it is that nobody chooses it, and a
       * box somebody can type into is a box that will hold `Welcome123` on half the accounts in
       * the studio. Regenerate is the only way it changes, which is what makes "read-only" mean
       * "not yours to pick" rather than "stuck".
       *
       * Shown in clear, deliberately. It is about to be emailed to the employee and read off the
       * hand-over dialog by whoever is onboarding them; masking it here would hide it from the one
       * person who needs to see it while changing nothing about who else can.
       */
      temporaryPassword: ({ error }) => <div className="block text-[11px] font-semibold text-slate-600 sm:text-xs">
        <span>Temporary Password<span aria-hidden="true" className="ml-0.5 text-rose-500">*</span></span>
        <div className="mt-1.5 flex flex-wrap gap-2">
          <input readOnly aria-label="Temporary password" aria-invalid={error ? "true" : undefined} value={shown.temporaryPassword} className={`min-h-9 min-w-0 flex-1 rounded-lg border ${error ? "border-red-400" : "border-slate-300"} bg-slate-100 px-3 font-mono text-xs font-normal tracking-wide text-slate-700 sm:text-sm`} />
          <button
            type="button"
            disabled={saving}
            onClick={() => change("temporaryPassword", generateTemporaryPassword())}
            className="min-h-9 shrink-0 rounded-lg border border-slate-300 px-3 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400 sm:text-sm"
          >Regenerate</button>
        </div>
        {/* Only an old draft saved without one can bring it back blank; Regenerate clears the mark. */}
        {error && <p role="alert" className="mt-1.5 font-normal text-red-600">{error}</p>}
        <p className="mt-1.5 font-normal text-slate-500">Generated for this account alone and emailed to the address above. Regenerate for a different one — whatever is shown here at the moment the account is created is the password that is sent.</p>
      </div>,
      roleIds: () => (rolesError
        ? <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{rolesError}</p>
        : <RolePicker
          roles={roles}
          selected={selectedRoles}
          busy={saving}
          // A tick is the role on the form: this page is saved as a whole, so there is no separate
          // Add step whose skipping would save the account without the roles it shows ticked.
          onChange={(next) => change("roleIds", next)}
          emptyText="No roles yet. This account will be able to sign in and nothing else until one is added."
        />),
      /*
       * Whether this person is held to WhatsApp, switched on one account at a time.
       *
       * Off unless somebody ticks it: nobody is held until the studio says so, which is what makes
       * the rule safe to ship. Ticked, that person meets the pairing dialog and cannot use the
       * application until the scan succeeds; unticking releases them again, with no deploy - which
       * is the answer for a lost or broken phone.
       *
       * Administrators are never held whatever this says, so the studio cannot be locked out of the
       * screen that would let it back in.
       */
      whatsappAllowed: () => <label className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white px-3 py-3">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-blue-600 focus-visible:ring-blue-500"
          checked={shown.whatsappAllowed === true}
          disabled={saving}
          onChange={(event) => change("whatsappAllowed", event.target.checked)}
        />
        <span className="min-w-0">
          <span className="block text-xs font-semibold text-slate-700 sm:text-sm">Allow WhatsApp</span>
          <span className="mt-1 block text-xs font-normal text-slate-500">
            Tick to make this person link WhatsApp before they can use the application.
          </span>
        </span>
      </label>,
      // The same tick box as Allow WhatsApp, for whether this person is kept out of attendance.
      excludeFromAttendance: () => <label className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white px-3 py-3">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-blue-600 focus-visible:ring-blue-500"
          checked={shown.excludeFromAttendance === true}
          disabled={saving}
          onChange={(event) => {
            change("excludeFromAttendance", event.target.checked);
            // Flexible Shift is how attendance is counted - kept out of attendance, it goes too.
            if (event.target.checked) change("allowFlexibleShift", false);
          }}
        />
        <span className="min-w-0">
          <span className="block text-xs font-semibold text-slate-700 sm:text-sm">Exclude From Attendance</span>
          <span className="mt-1 block text-xs font-normal text-slate-500">
            Tick to keep this person out of the Attendance module - not listed, not counted, and their days and details not shown there.
          </span>
        </span>
      </label>,
      // The WhatsApp groups this person is in, and adding them to more - on its own, not with Save.
      whatsappGroups: () => <EmployeeWhatsAppGroups employeeId={employee?.id} phone={employee?.contactNumber || ""} departmentSignal={departmentSignal} />,
      // The same tick box again, for whether this person may log in on a Flexible Shift.
      allowFlexibleShift: () => <label className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white px-3 py-3">
        <Checkbox
          className="mt-0.5 shrink-0"
          checked={shown.allowFlexibleShift === true && shown.excludeFromAttendance !== true}
          // Not for somebody excluded from attendance: it only says how their attendance is counted.
          disabled={saving || shown.excludeFromAttendance === true}
          onChange={(checked) => change("allowFlexibleShift", checked)}
        />
        <span className="min-w-0">
          <span className="block text-xs font-semibold text-slate-700 sm:text-sm">Allow Flexible Shift</span>
          <span className="mt-1 block text-xs font-normal text-slate-500">
            {shown.excludeFromAttendance === true
              ? "Not available while Exclude From Attendance is ticked - this person's attendance is not counted."
              : "Tick to let this person log in at any time. Their day is counted from login to logout by the Half day and Full day hours set in Attendance Rules, and never marked Late or Early exit."}
          </span>
        </span>
      </label>,
    },
  }), [candidates, change, roles, rolesError, saving, selectedRoles, showNotice, shown.alternative1EmployeeId, shown.alternative2EmployeeId, shown.email, shown.leaveApproverIds, shown.temporaryPassword, shown.whatsappAllowed, shown.excludeFromAttendance, shown.allowFlexibleShift, shown.username, employee?.id, employee?.contactNumber, departmentSignal]);

  // `values` is what the form shows — typed answers over the record's proposals. See `shown`.
  // `managing` says which page this is: an account being issued, or one being looked after. The
  // caller reads it to choose the sections, the heading and the button.
  // `showError` is handed back so the panel's own refusals speak through this page's notice.
  // Employment Details is validated by the panel and drawn on this page, so a press refused over
  // it has no other way to say what is missing - the record page's message goes through the
  // caller, and there is no caller in that path.
  return { ready, managing, account, values: shown, change, errors, context, branchName, loading, saving, error, result, notice, showError, clearNotice, submit, saveDraft, dirty, superAdminSelected };
}
