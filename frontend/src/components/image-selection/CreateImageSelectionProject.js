"use client";

import { useState } from "react";
import { DEFAULT_COUNTRY_CODE, formatClientPhone, validateClientPhone } from "@/lib/imageSelectionSettings.mjs";

// The stored number is "+91 9876543210"; the form edits the code and the digits separately.
function splitClientNumber(value) {
  const match = String(value || "").match(/^(\+\d{1,4})\s*(\d{10})$/);
  return match ? { code: match[1], number: match[2] } : { code: DEFAULT_COUNTRY_CODE, number: "" };
}

/**
 * Manual project creation only. A production project no longer needs creating here at all: the
 * moment the production team moves it into an in-progress state, the backend list sync puts it
 * in the sidebar as a linked project — so the one thing left to type is a project the studio
 * runs outside Project Management. With a `project`, the same form edits it instead: every field
 * starts from what the project holds, and the footer offers Save and Cancel.
 */
export default function CreateImageSelectionProject({ onCreate, project = null, onSave, onCancel }) {
  const editing = Boolean(project);
  const [manualName, setManualName] = useState(project?.projectName || "");
  const [clientName, setClientName] = useState(project?.clientName || "");
  const [clientCountryCode, setClientCountryCode] = useState(() => splitClientNumber(project?.clientMainNumber).code);
  const [clientNumber, setClientNumber] = useState(() => splitClientNumber(project?.clientMainNumber).number);
  // Which workspace tabs the manual project starts with. A linked project earns its tabs from
  // its Post Production Allocation, so the choice only exists here. Photo Selection starts on
  // because it is the tab every project used to have; a project being edited starts from the
  // choice it was created with, null reading as that same default.
  const [workspaceTabs, setWorkspaceTabs] = useState(() => editing
    ? { photoSelection: project.photoSelectionTab !== false, photoCulling: project.photoCullingTab === true, signatureAlbum: project.signatureAlbumTab === true }
    : { photoSelection: true, photoCulling: false, signatureAlbum: false });
  const [error, setError] = useState("");

  function submitProject(event) {
    event.preventDefault();
    const projectName = manualName.trim();
    if (!projectName) {
      setError("Please enter a project name.");
      return;
    }
    // Every field is required. A manually named project has no Sales Manager project to fall
    // back on, so a project created without a client is one whose gallery can never be shared —
    // the form refuses to create it rather than leave that to be discovered later. Checked in
    // the order they are read, so the message always names the first gap.
    if (!clientName.trim()) {
      setError("Please enter the client's name.");
      return;
    }
    if (!clientNumber.trim()) {
      setError("Please enter the client's WhatsApp number.");
      return;
    }
    if (!validateClientPhone(clientCountryCode, clientNumber)) {
      setError("Enter a country code and exactly 10 digits.");
      return;
    }
    // A project with no tabs would open onto an empty workspace, so at least one is required —
    // the same rule the backend enforces.
    if (!workspaceTabs.photoSelection && !workspaceTabs.photoCulling && !workspaceTabs.signatureAlbum) {
      setError("Choose at least one workspace tab.");
      return;
    }

    const payload = {
      clientName: clientName.trim(),
      clientMainNumber: formatClientPhone(clientCountryCode, clientNumber),
      workspaceTabs: { ...workspaceTabs },
    };

    // Saving an edit sends the same fields; the parent closes the form, so no state is reset here.
    if (editing) {
      Promise.resolve(onSave({ projectName, ...payload })).catch((saveError) => {
        setError(saveError.message || "Unable to save the project.");
      });
      return;
    }

    Promise.resolve(onCreate(projectName, payload))
      .then(() => {
        setError("");
        setManualName("");
        setClientName("");
        setClientCountryCode(DEFAULT_COUNTRY_CODE);
        setClientNumber("");
        setWorkspaceTabs({ photoSelection: true, photoCulling: false, signatureAlbum: false });
      })
      .catch((createError) => {
        setError(createError.message || "Unable to create project.");
      });
  }

  return (
    <form onSubmit={submitProject} className="w-full max-w-[410px]">
      <h1 className="text-xl font-semibold tracking-tight text-slate-900">
        {editing ? "Edit Project" : "Create New Project"}
      </h1>
      {!editing && (
        <p className="mt-2 text-[11px] text-slate-500">
          Production projects appear in the sidebar automatically once they are In Progress —
          create a project here only for work outside Project Management.
        </p>
      )}

      <div className="mt-7 space-y-3">
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold text-slate-700">Project Name<span aria-hidden="true" className="ml-0.5 text-rose-500">*</span></span>
          <input
            autoFocus
            value={manualName}
            aria-required="true"
            onChange={(event) => {
              setManualName(event.target.value);
              setError("");
            }}
            placeholder="Enter Project Name..."
            className="h-8 w-full rounded-md border border-slate-300 px-3 text-xs text-slate-700 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
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
            onChange={(event) => {
              setClientName(event.target.value);
              setError("");
            }}
            placeholder="Client name for the invite"
            className="h-8 w-full rounded-md border border-slate-300 px-3 text-xs text-slate-700 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </label>

        <div>
          <label className="mb-1 block text-[10px] font-semibold text-slate-700" htmlFor="create-is-client-number">
            Client WhatsApp Number<span aria-hidden="true" className="ml-0.5 text-rose-500">*</span>
          </label>
          {/* Country code and number are two inputs sharing one border, the same shape the Sales
              and Project Management create forms use, so a number looks the same wherever it is
              typed. */}
          <div className="flex h-8 rounded-md border border-slate-300 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100">
            <input
              value={clientCountryCode}
              maxLength={5}
              inputMode="tel"
              aria-label="Client country code"
              onChange={(event) => {
                setClientCountryCode(event.target.value.replace(/[^+\d]/g, "").replace(/(\+.*)\+/g, "$1").slice(0, 5));
                setError("");
              }}
              className="w-14 rounded-l-md border-r border-slate-200 bg-slate-50 px-2 text-center text-xs text-slate-700 outline-none"
            />
            <input
              id="create-is-client-number"
              value={clientNumber}
              inputMode="numeric"
              aria-required="true"
              onChange={(event) => {
                setClientNumber(event.target.value.replace(/\D/g, "").slice(0, 10));
                setError("");
              }}
              placeholder="10-digit number"
              className="min-w-0 flex-1 rounded-r-md px-3 text-xs text-slate-700 outline-none placeholder:text-slate-400"
            />
          </div>
        </div>

        {/* The tabs this project's workspace opens with. A linked project earns them from its
            Post Production Allocation; a manual project has none, so they are chosen here. */}
        <fieldset>
          <legend className="mb-1 block text-[10px] font-semibold text-slate-700">
            Selection Fields<span className="text-red-600"> *</span>
          </legend>
          <div className="space-y-1.5 rounded-md border border-slate-300 px-3 py-2">
            {[
              ["photoSelection", "Photo Selection"],
              ["photoCulling", "Photo Culling"],
              ["signatureAlbum", "Signature Album"],
            ].map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={workspaceTabs[key]}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setWorkspaceTabs((current) => ({ ...current, [key]: checked }));
                    setError("");
                  }}
                  className="h-4 w-4 rounded border-slate-300 text-blue-600"
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <p role={error ? "alert" : undefined} className={`mt-2 min-h-4 text-[10px] ${error ? "text-red-600" : "text-slate-500"}`}>
        {error || "All three are required: the client's name and number are what the gallery link and PIN are sent to."}
      </p>

      <div className="mt-2 flex items-center gap-2">
        <button
          type="submit"
          className="h-8 rounded-md bg-blue-600 px-4 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-300"
        >
          {editing ? "Save" : "Create Project"}
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
