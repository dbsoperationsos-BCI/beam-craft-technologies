"use client";

import Link from "next/link";
import { useState } from "react";
import { usePermissions } from "@/components/auth/PermissionsProvider";
import Checkbox from "@/components/shared/Checkbox";
import useFormErrors from "@/components/shared/useFormErrors";
import { LINKED_MODULES_NOTE, PROJECT_MODULES, linkChanges, linkEntriesOf, linkedModuleOptions, stageProjectsHref } from "@/lib/stageDashboards.mjs";
import { DEFAULT_COUNTRY_CODE, formatClientPhone, validateClientPhone } from "@/lib/imageSelectionSettings.mjs";

// The stored number is "+91 9876543210"; the form edits the code and the digits separately.
function splitClientNumber(value) {
  const match = String(value || "").match(/^(\+\d{1,4})\s*(\d{10})$/);
  return match ? { code: match[1], number: match[2] } : { code: DEFAULT_COUNTRY_CODE, number: "" };
}

/**
 * Create Project, the one form every Visual Curation module shares - Photo Selection, AI Culling,
 * AI Editing and Signature Album - for a project the studio runs outside Project Management (a
 * production project joins the sidebar by itself once it is started). With a `project`, the same
 * form edits it instead: every field starts from what the project holds, and the footer offers
 * Save and Cancel.
 *
 * Linked Modules: the other modules this project is also made in - each gets a project of its own,
 * with its own ID, on the same submission, and they are linked by being created together. The
 * choices are the viewer's own: a module appears only where they may create projects (Read / Write
 * on it), and never the module the form belongs to, which is always included. The server asks the
 * same question again, so a module the form did not offer is refused.
 *
 * Editing, Linked Modules are the project's links as they stand (`project.moduleLinks`, from the
 * server): ticked where linked. Only the modules the viewer may open are listed, and only those they
 * may Read / Write can be changed - the rest are shown greyed. Unticking unlinks and keeps the other
 * project with everything in it; ticking links again - the same project, or a new one in a module
 * that has none - all saved with the name, in one go. A client still holding the other project's
 * link has it unpublished there first: the save says so and offers that module's project.
 */

// The box border, red while that box is the one to fix.
const boxBorder = (invalid) => (invalid ? "border-red-400" : "border-slate-300");
const FieldError = ({ children }) => (children ? <p role="alert" className="mt-1 text-[10px] font-normal text-red-600">{children}</p> : null);

// `module` is the module the form belongs to - culling, editing or album; none is Photo Selection.
export default function CreateImageSelectionProject({ onCreate, project = null, onSave, onCancel, module = null }) {
  const editing = Boolean(project);
  const current = module || "photos";
  const moduleLabel = PROJECT_MODULES[current].label;
  const { hasPermission } = usePermissions();
  const linkedOptions = editing ? [] : linkedModuleOptions(current, hasPermission);
  const [manualName, setManualName] = useState(project?.projectName || "");
  const [clientName, setClientName] = useState(project?.clientName || "");
  const [clientCountryCode, setClientCountryCode] = useState(() => splitClientNumber(project?.clientMainNumber).code);
  const [clientNumber, setClientNumber] = useState(() => splitClientNumber(project?.clientMainNumber).number);
  // The modules ticked under Linked Modules; none to begin with - each is a project of its own.
  const [linkedModules, setLinkedModules] = useState([]);
  // Editing: the project's Linked Modules, ticked where linked; only what changed is sent.
  const linkEntries = editing ? linkEntriesOf(project) : [];
  const [ticks, setTicks] = useState(() => Object.fromEntries(linkEntries.map((entry) => [entry.module, entry.linked])));
  // The module whose client link stopped an unlink, so the form can offer its project.
  const [blockedModule, setBlockedModule] = useState(null);
  // One submission at a time: a second press while the first is creating projects is ignored.
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fields = useFormErrors();

  function submitProject(event) {
    event.preventDefault();
    setError("");
    const projectName = manualName.trim();
    // Every field is required. A manually named project has no Sales Manager project to fall
    // back on, so a project created without a client is one whose gallery can never be shared —
    // the form refuses to create it rather than leave that to be discovered later. Each gap is
    // said under its own box.
    const ok = fields.check({
      manualName: projectName ? "" : "Enter a project name.",
      clientName: clientName.trim() ? "" : "Enter the client's name.",
      clientNumber: !clientNumber.trim() ? "Enter the client's WhatsApp number."
        : validateClientPhone(clientCountryCode, clientNumber) ? "" : "Enter a country code and exactly 10 digits.",
    });
    if (!ok || busy) return;

    const payload = {
      clientName: clientName.trim(),
      clientMainNumber: formatClientPhone(clientCountryCode, clientNumber),
    };

    setBusy(true);
    // Saving an edit sends the name and client, and the Linked Modules ticks that changed.
    if (editing) {
      const links = linkChanges(linkEntries, ticks);
      setBlockedModule(null);
      Promise.resolve(onSave({ projectName, ...payload, ...(Object.keys(links).length ? { links } : {}) }))
        .catch((saveError) => {
          setError(saveError.message || "Unable to save the project.");
          const details = saveError?.data?.details;
          if (details?.code === "CLIENT_LINK_ACTIVE" && PROJECT_MODULES[details.module]) setBlockedModule(details.module);
        })
        .finally(() => setBusy(false));
      return;
    }

    // Only what is still offered is sent: a module whose permission went away since it was ticked
    // is dropped here, and the server refuses it anyway.
    Promise.resolve(onCreate(projectName, { ...payload, sourceModule: current, linkedModules: linkedModules.filter((entry) => linkedOptions.includes(entry)) }))
      .then(() => {
        setError("");
        setManualName("");
        setClientName("");
        setClientCountryCode(DEFAULT_COUNTRY_CODE);
        setClientNumber("");
        setLinkedModules([]);
      })
      // The entered values stay, so a refused create is fixed and sent again rather than retyped.
      .catch((createError) => setError(createError.message || "Unable to create project."))
      .finally(() => setBusy(false));
  }

  return (
    <form onSubmit={submitProject} className="w-full max-w-[410px]">
      <h1 className="text-xl font-semibold tracking-tight text-slate-900">
        {editing ? "Edit Project" : `Create New ${moduleLabel} Project`}
      </h1>
      {!editing && (
        <p className="mt-2 text-[11px] text-slate-500">
          Production projects appear in the sidebar automatically once they are started — create a project here only for work outside Project Management.
        </p>
      )}

      <div className="mt-7 space-y-3">
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold text-slate-700">Project Name<span aria-hidden="true" className="ml-0.5 text-rose-500">*</span></span>
          <input
            autoFocus
            value={manualName}
            aria-required="true"
            aria-invalid={fields.errors.manualName ? true : undefined}
            onChange={(event) => {
              setManualName(event.target.value);
              setError("");
              fields.clear("manualName");
            }}
            placeholder="Enter Project Name..."
            className={`h-8 w-full rounded-md border ${boxBorder(fields.errors.manualName)} px-3 text-xs text-slate-700 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100`}
          />
          <FieldError>{fields.errors.manualName}</FieldError>
        </label>

        <label className="block" htmlFor="create-is-client-name">
          <span className="mb-1 block text-[10px] font-semibold text-slate-700">Client Name<span aria-hidden="true" className="ml-0.5 text-rose-500">*</span></span>
          <input
            id="create-is-client-name"
            value={clientName}
            maxLength={191}
            // Marked required for a screen reader, but not with the native attribute: the browser
            // would interrupt with its own bubble instead of the one error line this form uses.
            aria-required="true"
            aria-invalid={fields.errors.clientName ? true : undefined}
            onChange={(event) => {
              setClientName(event.target.value);
              setError("");
              fields.clear("clientName");
            }}
            placeholder="Client name for the invite"
            className={`h-8 w-full rounded-md border ${boxBorder(fields.errors.clientName)} px-3 text-xs text-slate-700 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100`}
          />
          <FieldError>{fields.errors.clientName}</FieldError>
        </label>

        <div>
          <label className="mb-1 block text-[10px] font-semibold text-slate-700" htmlFor="create-is-client-number">
            Client WhatsApp Number<span aria-hidden="true" className="ml-0.5 text-rose-500">*</span>
          </label>
          {/* Country code and number are two inputs sharing one border, the same shape the Sales
              and Project Management create forms use, so a number looks the same wherever it is
              typed. */}
          <div className={`flex h-8 rounded-md border ${boxBorder(fields.errors.clientNumber)} focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100`}>
            <input
              value={clientCountryCode}
              maxLength={5}
              inputMode="tel"
              aria-label="Client country code"
              onChange={(event) => {
                setClientCountryCode(event.target.value.replace(/[^+\d]/g, "").replace(/(\+.*)\+/g, "$1").slice(0, 5));
                setError("");
                fields.clear("clientNumber");
              }}
              className="w-14 rounded-l-md border-r border-slate-200 bg-slate-50 px-2 text-center text-xs text-slate-700 outline-none"
            />
            <input
              id="create-is-client-number"
              value={clientNumber}
              inputMode="numeric"
              aria-required="true"
              aria-invalid={fields.errors.clientNumber ? true : undefined}
              onChange={(event) => {
                setClientNumber(event.target.value.replace(/\D/g, "").slice(0, 10));
                setError("");
                fields.clear("clientNumber");
              }}
              placeholder="10-digit number"
              className="min-w-0 flex-1 rounded-r-md px-3 text-xs text-slate-700 outline-none placeholder:text-slate-400"
            />
          </div>
          <FieldError>{fields.errors.clientNumber}</FieldError>
        </div>

        {/* Linked Modules: the other modules this project is made in too, each its own project. Only
            the modules the viewer may create projects in, and never this one. */}
        {!editing && linkedOptions.length > 0 && <fieldset>
          <legend className="mb-1 block text-[10px] font-semibold text-slate-700">Linked Modules</legend>
          <div className="space-y-1.5 rounded-md border border-slate-300 px-3 py-2">
            {linkedOptions.map((key) => (
              <label key={key} className="flex items-center gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={linkedModules.includes(key)}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setLinkedModules((selected) => (checked ? [...selected, key] : selected.filter((entry) => entry !== key)));
                    setError("");
                  }}
                  className="h-4 w-4 rounded border-slate-300 text-blue-600"
                />
                {PROJECT_MODULES[key].label}
              </label>
            ))}
          </div>
          <p className="mt-1 text-[10px] text-slate-500">Each module ticked gets its own project, with its own ID, linked to this one - photos can then be sent on to it.</p>
        </fieldset>}

        {/* Edit Project's Linked Modules: the same boxes, ticked where linked. A greyed box is one
            the viewer may see but not change. */}
        {editing && linkEntries.length > 0 && <fieldset>
          <legend className="mb-1 block text-[10px] font-semibold text-slate-700">Linked Modules</legend>
          <div className="space-y-1.5 rounded-md border border-slate-300 px-3 py-2">
            {linkEntries.map((entry) => (
              <label key={entry.module} className={`flex items-center gap-2 text-xs ${entry.canChange ? "text-slate-700" : "text-slate-400"}`}>
                <Checkbox
                  checked={Boolean(ticks[entry.module])}
                  disabled={busy || !entry.canChange}
                  title={entry.canChange ? undefined : `You can't change links to ${PROJECT_MODULES[entry.module].label}.`}
                  onChange={(checked) => {
                    setTicks((current) => ({ ...current, [entry.module]: checked }));
                    setError("");
                    setBlockedModule(null);
                  }}
                />
                <span className="min-w-0 flex-1 truncate">{PROJECT_MODULES[entry.module].label}</span>
                <span className="shrink-0 text-[10px] text-slate-400">{entry.member ? entry.projectCode : ticks[entry.module] ? "New project" : ""}</span>
              </label>
            ))}
          </div>
          <p className="mt-1 text-[10px] text-slate-500">
            {LINKED_MODULES_NOTE} Unticking unlinks only - the other project and its photos are kept, and ticking it again reconnects the same project.
            {linkEntries.some((entry) => !entry.canChange) ? " Greyed modules can be changed only with Read / Write on them." : ""}
          </p>
        </fieldset>}
      </div>

      <p role={error || fields.summary ? "alert" : undefined} className={`mt-2 min-h-4 text-[10px] ${error || fields.summary ? "text-red-600" : "text-slate-500"}`}>
        {error || fields.summary || "All three are required: the client's name and number are what the gallery link and PIN are sent to."}
      </p>
      {/* An unlink waiting on a client's link: that module's project, where it is unpublished. */}
      {blockedModule && (
        <Link href={stageProjectsHref(blockedModule, { projectId: project.id })} className="mt-1 inline-block text-[11px] font-semibold text-blue-600 hover:underline">
          Open the {PROJECT_MODULES[blockedModule].label} project to unpublish it
        </Link>
      )}

      <div className="mt-2 flex items-center gap-2">
        <button
          type="submit"
          disabled={busy}
          aria-busy={busy || undefined}
          className="h-8 rounded-md bg-blue-600 px-4 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:opacity-60"
        >
          {busy ? (editing ? "Saving..." : "Creating...") : editing ? "Save" : "Create Project"}
        </button>
        {editing && (
          <button
            type="button"
            onClick={onCancel}
            className="h-8 rounded-md border border-slate-300 bg-white px-4 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-200"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
