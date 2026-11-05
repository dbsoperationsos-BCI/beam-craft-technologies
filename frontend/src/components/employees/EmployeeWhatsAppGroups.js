"use client";

import { useCallback, useEffect, useState } from "react";
import Button from "@/components/shared/Button";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import InlineAlert from "@/components/shared/InlineAlert";
import MultiSelectField from "@/components/shared/MultiSelectField";
import { usePermissions } from "@/components/auth/PermissionsProvider";
import { addEmployeeToWhatsAppGroups, getEmployeeGroupMemberships, removeEmployeeFromWhatsAppGroups } from "@/services/hrm/whatsapp-groups.service";

/**
 * Employee Preference -> WhatsApp Groups: a multi-select of the groups saved in Settings -> Employee ->
 * WhatsApp Groups, and **Add**. Pressing Add adds this employee's mobile number to each group ticked -
 * one group at a time in the background, through a linked WhatsApp that is admin of it - and the list
 * under it says how each add went. Not part of the form's Save Changes.
 *
 * Groups they are already in are not offered again; nobody is taken out of a group from here.
 * `HRM / Employee Management`: Read shows the groups, Read / Write ticks them.
 */
/**
 * What each group's add came to, as the pill says it and as the line under it explains it.
 *
 * `say` is what the row reads when WhatsApp gave no reason of its own - every outcome says
 * something, because "Invite link sent" with nothing under it leaves the reader wondering whether
 * that was the plan. Where WhatsApp did answer (`row.detail`), that is shown instead: it is the more
 * specific of the two, and it is what tells apart a privacy setting from somebody who just left.
 *
 * `alert` is the tone the line is drawn in (`InlineAlert`), and `ADDED` has none - a plain success
 * needs no explaining and a line under every added group would bury the ones that need reading.
 */
const STATUS = {
  PENDING: { label: "Adding…", tone: "bg-amber-50 text-amber-700 border-amber-200", alert: "info", say: "Waiting its turn - each group is added a few seconds after the last." },
  ADDED: { label: "Added", tone: "bg-emerald-50 text-emerald-700 border-emerald-200", alert: null, say: "" },
  ALREADY: { label: "Already in group", tone: "bg-emerald-50 text-emerald-700 border-emerald-200", alert: "success", say: "They were already a member, so nothing was sent." },
  INVITED: { label: "Invite link sent", tone: "bg-blue-50 text-blue-700 border-blue-200", alert: "warning", say: "WhatsApp would not let them be added, so the group's invite link was sent to them instead. They join by tapping it." },
  FAILED: { label: "Not added", tone: "bg-red-50 text-red-700 border-red-200", alert: "error", say: "WhatsApp would not add them, and no invite link could be sent." },
};
// Ticked in the multi-select: in the group, on the way, or sent its link.
const TICKED = ["ADDED", "ALREADY", "PENDING", "INVITED"];

/*
 * `departmentSignal` is the employee form's live department text, handed down so this re-reads when
 * it changes. The groups offered are the saved departments' - and Employment Details, on another
 * page of the same panel, saves the department the moment it changes. Without the signal this box
 * had already fetched and had no reason to ask again, so it sat empty right after somebody had
 * chosen departments.
 */
export default function EmployeeWhatsAppGroups({ employeeId, phone, departmentSignal = "" }) {
  const { hasPermission } = usePermissions();
  const canWrite = hasPermission("HRM", "Employee Management", "READ_WRITE");
  const [groups, setGroups] = useState(null);
  // The departments the server looked at. "No groups" needs them: no departments saved and
  // departments-with-no-groups are different problems with opposite fixes.
  const [departmentNames, setDepartmentNames] = useState([]);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  /*
   * `null` until somebody touches the box, which is what lets the default be **derived** rather than
   * written into state by an effect: the studio's answer for this department is "all of its groups",
   * so that is what the box holds when it is opened, and taking one off is the decision. Derived, a
   * tick just removed is never put back by a reload; set, it would be.
   */
  const [picked, setPicked] = useState(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // What the queue answered - "Leaving 6 groups, about half a minute apart" - so a removal that has
  // not visibly happened yet does not read as nothing having happened.
  const [notice, setNotice] = useState("");

  /*
   * One read for both halves: where each add stands, and the groups this employee is **offered**.
   *
   * Offered is their departments' groups, decided in Settings, and not every group in the studio.
   * The studio has already said which groups a department has; a picker listing all of them asked
   * whoever is on this screen to decide it again, differently, and without the context to.
   */
  const loadRows = useCallback(async () => {
    if (!employeeId) return;
    try {
      const result = await getEmployeeGroupMemberships(employeeId);
      setRows(Array.isArray(result?.data?.memberships) ? result.data.memberships : []);
      setGroups(Array.isArray(result?.data?.groups) ? result.data.groups : []);
      setDepartmentNames(Array.isArray(result?.data?.departmentNames) ? result.data.departmentNames : []);
    } catch (caught) {
      setGroups([]);
      setError(caught?.message || "Unable to load this employee's WhatsApp groups.");
    }
    // `departmentSignal` is not read here - it is a dependency, so a change to it re-reads the
    // groups the saved departments now offer.
  }, [departmentSignal, employeeId]);
  useEffect(() => { const timer = setTimeout(() => void loadRows(), 0); return () => clearTimeout(timer); }, [loadRows]);




  // While an add is still waiting its turn, the rows are read again every few seconds.
  const waiting = rows.some((row) => row.status === "PENDING");
  useEffect(() => {
    if (!waiting) return undefined;
    const timer = setInterval(() => void loadRows(), 3000);
    return () => clearInterval(timer);
  }, [loadRows, waiting]);

  async function add(groupIds) {
    setNotice("");
    setError("");
    setAdding(true);
    try {
      const result = await addEmployeeToWhatsAppGroups(employeeId, groupIds);
      setRows(Array.isArray(result?.data?.memberships) ? result.data.memberships : []);
      setGroups(Array.isArray(result?.data?.groups) ? result.data.groups : groups);
      setDepartmentNames(Array.isArray(result?.data?.departmentNames) ? result.data.departmentNames : departmentNames);
      // Back to derived, so the next read's defaults are shown rather than a stale set of ticks.
      setPicked(null);
    } catch (caught) {
      setError(caught?.message || "Unable to add them to those groups.");
    } finally {
      setAdding(false);
    }
  }

  /*
   * **Out of every group**, for somebody who is leaving or has already gone.
   *
   * Recording an exit queues this on its own now, but it cannot reach the people already marked
   * inactive by a status change: they have no separation, so no job will ever find them. Doing it
   * from here is the alternative to recording an exit retroactively, which would also close their
   * login and move their reports - a lot to do to fix a WhatsApp group.
   *
   * Asked first, because it cannot be undone from this screen: putting them back is an Add, one group
   * at a time, and the studio's number does the leaving either way.
   */
  async function removeFromAll() {
    setError("");
    setRemoving(true);
    try {
      const result = await removeEmployeeFromWhatsAppGroups(employeeId);
      setNotice(result?.message || "");
      await loadRows();
    } catch (caught) {
      setError(caught?.message || "Unable to take them out of their groups.");
    } finally {
      setRemoving(false);
      setConfirming(false);
    }
  }

  // Adding somebody to a group needs their record to exist, so a new employee is told plainly here
  // rather than being offered an Add that answers 404.
  if (!employeeId) return <InlineAlert tone="info">Save this employee first, then add them to WhatsApp groups.</InlineAlert>;
  if (groups === null) return <p className="text-sm text-slate-500">Loading WhatsApp groups…</p>;

  // Groups they are in (or on the way in) are not offered again.
  const inGroups = rows.filter((row) => TICKED.includes(row.status)).map((row) => row.groupId);
  /*
   * Only their departments' groups, plus any they are already in that their department no longer
   * claims - a membership that exists has to be visible, whatever the department says now.
   */
  /*
   * Why there is nothing to choose, in the words of the thing to go and fix.
   *
   * A department picked on the employee's form but not yet **saved** is not a department here: the
   * groups follow the saved record. Without saying so, the box just sat empty while somebody had
   * visibly selected departments a moment earlier.
   */
  const nothingToOffer = !departmentNames.length
    ? "No departments saved for this employee yet - set them under Employment Details and save, then their groups appear here."
    : `${departmentNames.join(", ")} ${departmentNames.length === 1 ? "has" : "have"} no WhatsApp groups - give them some in Settings -> Employee -> WhatsApp Groups.`;

  const offerable = groups.filter((group) => !inGroups.includes(group.id));
  const options = offerable.map((group) => ({
    value: String(group.id),
    label: group.fromDepartment ? group.subject : `${group.subject} (not in their department)`,
  }));
  // Every group their departments claim, ticked. Untouched, that is what Add would put them into.
  const values = picked ?? offerable.filter((group) => group.fromDepartment).map((group) => String(group.id));
  const shownRows = rows.filter((row) => groups.some((group) => group.id === row.groupId));


  return <div className="space-y-3">
    {notice && <InlineAlert tone="success" size="sm">{notice}</InlineAlert>}
    {confirming && <ConfirmDialog
      title="Take them out of every WhatsApp group?"
      message={`This employee will be removed from all ${inGroups.length} group${inGroups.length === 1 ? "" : "s"} the app has them in. They go one at a time, about half a minute apart, from the studio's own number. Putting them back is one Add per group.`}
      confirmLabel="Remove from all"
      busyLabel="Removing..."
      tone="danger"
      loading={removing}
      onConfirm={() => void removeFromAll()}
      onCancel={() => setConfirming(false)}
    />}
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
      <MultiSelectField
        label="WhatsApp Groups"
        className="min-w-0 flex-1"
        options={options}
        values={values}
        onChange={(next) => { setPicked(next); setError(""); }}
        placeholder={!groups.length ? nothingToOffer : options.length ? "Choose WhatsApp groups" : "Already in every group their departments have"}
        searchable
        disabled={adding || !options.length || !phone}
        readOnly={!canWrite}
        helperText={!groups.length
          ? nothingToOffer
          : phone
            ? `${departmentNames.join(", ")}: their groups are ticked for them - take off any they should not be in. Add puts ${phone} into the rest, one group every few seconds; if their privacy blocks it, the group's invite link is sent instead.`
            : "Add this employee's mobile number first - it is the number added to the groups."}
        error={error}
      />
      {canWrite && <Button type="button" variant="primary" className="shrink-0 sm:mt-6 max-sm:w-full" disabled={adding || !values.length} onClick={() => void add(values.map(Number))}>{adding ? "Adding..." : "Add"}</Button>}
    </div>
    {/*
      * **Leaving every group at once**, for somebody who has left the studio.
      *
      * Under the list rather than beside Add, because it acts on what the list shows rather than on
      * what is picked above it - and absent when they are in nothing, rather than offered and
      * refusing. Recording an exit does this on its own now; this is for the people already marked
      * inactive without one, whom no job will ever reach.
      */}
    {canWrite && inGroups.length > 0 && <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs text-slate-500">Leaving the studio? Take them out of all {inGroups.length} {inGroups.length === 1 ? "group" : "groups"} at once.</p>
      <Button type="button" variant="danger" size="sm" className="max-sm:w-full" disabled={removing} onClick={() => setConfirming(true)}>Remove from all groups</Button>
    </div>}
    {shownRows.length > 0 && <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white px-3">
      {shownRows.map((row) => {
        const status = STATUS[row.status] || STATUS.FAILED;
        return <li key={row.groupId} className="flex flex-wrap items-center gap-2 py-2">
          <span className="min-w-0 flex-1 truncate text-sm text-slate-800">{row.subject}</span>
          <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${status.tone}`}>{status.label}</span>
          {/* Under the row, in the outcome's own colour: what happened to this group and why.
              WhatsApp's own reason where it gave one, this status's words where it did not. */}
          {status.alert && <InlineAlert tone={status.alert} size="sm" className="w-full" action={row.status === "FAILED" && canWrite
            ? <Button type="button" variant="plain" size="sm" onClick={() => void add([row.groupId])}>Retry</Button>
            : null}
          >
            {row.detail || status.say}
          </InlineAlert>}
        </li>;
      })}
    </ul>}
  </div>;
}
