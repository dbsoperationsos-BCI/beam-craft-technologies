"use client";

import ExpandMore from "@mui/icons-material/ExpandMore";
import { useEffect, useMemo, useRef, useState } from "react";
import useEscapeKey from "@/components/shared/useEscapeKey";
import { availableGroupNames, filterGroupNames } from "@/lib/albumProofingGroupNames.mjs";
import { DEFAULT_COUNTRY_CODE, formatClientPhone, validateClientPhone } from "@/lib/imageSelectionSettings.mjs";
import { getSalesProjects } from "@/services/sales/projects.service";

const inputClass = "h-8 w-full rounded-md border border-slate-300 px-3 text-xs text-slate-700 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

/**
 * The Album Proofing page's own New Project form. Unlike the Projects page, an Album Proofing
 * project is not created by the list sync when production starts, so this form offers the two
 * ways in: pick a saved WhatsApp group name from an in-progress Sales Manager project (the
 * project is then linked and reads its client from there), or type a manual project name with
 * the client the proof link is sent to. Editing stays with the shared Image Selection edit form.
 *
 * `onCreate(projectName, { salesProjectId, clientName?, clientMainNumber? })` — the same call
 * shape the Projects page's create flow uses, so the page's `createProject` needs no change.
 */
export default function CreateAlbumProofingProject({ onCreate, usedSalesProjectIds = [] }) {
  const [nameMode, setNameMode] = useState("saved");
  const [savedProjectId, setSavedProjectId] = useState("");
  const [groupNameSearch, setGroupNameSearch] = useState("");
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [manualName, setManualName] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientCountryCode, setClientCountryCode] = useState(DEFAULT_COUNTRY_CODE);
  const [clientNumber, setClientNumber] = useState("");
  const [salesProjects, setSalesProjects] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const pickerRef = useRef(null);

  useEffect(() => {
    let active = true;
    getSalesProjects()
      .then((response) => { if (active) setSalesProjects(response.data || []); })
      .catch((loadError) => { if (active) setError(loadError.message || "Unable to load Sales Manager group names."); })
      .finally(() => { if (active) setIsLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    function closePicker(event) {
      if (!pickerRef.current?.contains(event.target)) setIsPickerOpen(false);
    }
    document.addEventListener("mousedown", closePicker);
    return () => document.removeEventListener("mousedown", closePicker);
  }, []);

  // Escape goes through the one arbiter, and only while the list is open: a picker inside a dialog
  // that listened for itself closed both at once, which is the fault `useEscapeKey` exists to stop.
  useEscapeKey(() => setIsPickerOpen(false), isPickerOpen);

  const groupNames = useMemo(() => availableGroupNames(salesProjects, usedSalesProjectIds), [salesProjects, usedSalesProjectIds]);
  const filteredGroupNames = useMemo(() => filterGroupNames(groupNames, groupNameSearch), [groupNames, groupNameSearch]);
  const selectedSalesProject = groupNames.find((project) => project.id === savedProjectId);

  function resetForm() {
    setError("");
    setSavedProjectId("");
    setGroupNameSearch("");
    setIsPickerOpen(false);
    setManualName("");
    setClientName("");
    setClientCountryCode(DEFAULT_COUNTRY_CODE);
    setClientNumber("");
  }

  function submitProject(event) {
    event.preventDefault();
    if (nameMode === "saved") {
      if (!selectedSalesProject) {
        setError("Please select a saved group name.");
        return;
      }
      Promise.resolve(onCreate(selectedSalesProject.whatsappGroupName.trim(), { salesProjectId: selectedSalesProject.id }))
        .then(resetForm)
        .catch((createError) => setError(createError.message || "Unable to create project."));
      return;
    }

    const projectName = manualName.trim();
    if (!projectName) {
      setError("Please enter a project name.");
      return;
    }
    // A manual project has no Sales Manager project behind it, so the client the proof link is
    // sent to is recorded here — and only here. Checked in the order they are read.
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
    Promise.resolve(onCreate(projectName, {
      salesProjectId: null,
      clientName: clientName.trim(),
      clientMainNumber: formatClientPhone(clientCountryCode, clientNumber),
    }))
      .then(resetForm)
      .catch((createError) => setError(createError.message || "Unable to create project."));
  }

  function switchMode(mode) {
    setNameMode(mode);
    setError("");
    setIsPickerOpen(false);
  }

  const modeButtonClass = (active) => `h-8 px-3 text-xs font-medium transition ${active ? "bg-blue-50 text-blue-600" : "bg-white text-slate-600 hover:bg-slate-50"}`;

  return (
    <form onSubmit={submitProject} className="w-full max-w-[410px]">
      <h1 className="text-xl font-semibold tracking-tight text-slate-900">Create New Project</h1>

      <fieldset className="mt-7">
        <legend className="mb-2 text-[10px] font-semibold text-slate-700">
          Project Name<span aria-hidden="true" className="ml-0.5 text-rose-500">*</span>
        </legend>
        {/* The two buttons share one border and wrap on a narrow phone rather than overflow. */}
        <div className="inline-flex max-w-full flex-wrap overflow-hidden rounded-md border border-slate-300">
          <button type="button" aria-pressed={nameMode === "saved"} onClick={() => switchMode("saved")} className={modeButtonClass(nameMode === "saved")}>
            Select Saved Group Name
          </button>
          <button type="button" aria-pressed={nameMode === "manual"} onClick={() => switchMode("manual")} className={`border-l border-slate-300 ${modeButtonClass(nameMode === "manual")}`}>
            Use Manual Project Name
          </button>
        </div>
      </fieldset>

      {nameMode === "saved" ? (
        <div ref={pickerRef} className="relative mt-1">
          <div className="relative">
            <label className="block">
              <span className="sr-only">Search and select saved group name</span>
              <input
                role="combobox"
                aria-expanded={isPickerOpen}
                aria-controls="album-proofing-group-name-options"
                aria-autocomplete="list"
                disabled={isLoading}
                value={groupNameSearch}
                onFocus={() => setIsPickerOpen(true)}
                onChange={(event) => {
                  const value = event.target.value;
                  setGroupNameSearch(value);
                  if (value !== selectedSalesProject?.whatsappGroupName) setSavedProjectId("");
                  setIsPickerOpen(true);
                  setError("");
                }}
                placeholder={isLoading ? "Loading Sales Manager group names..." : "Search Group Name..."}
                className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 pr-9 text-xs text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50 disabled:text-slate-400"
              />
            </label>
            <button type="button" aria-label="Show saved group names" disabled={isLoading} onClick={() => setIsPickerOpen(true)} className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-slate-500 disabled:text-slate-300">
              <ExpandMore style={{ fontSize: 15 }} aria-hidden="true" />
            </button>
          </div>
          {isPickerOpen && (
            <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-md border border-slate-300 bg-white shadow-lg">
              <div id="album-proofing-group-name-options" role="listbox" aria-label="Saved group names" className="max-h-52 overflow-y-auto py-1">
                {filteredGroupNames.length ? filteredGroupNames.map((project) => (
                  <button
                    key={project.id}
                    type="button"
                    role="option"
                    aria-selected={savedProjectId === project.id}
                    onClick={() => {
                      setSavedProjectId(project.id);
                      setGroupNameSearch(project.whatsappGroupName);
                      setIsPickerOpen(false);
                      setError("");
                    }}
                    className={`block w-full px-3 py-2 text-left text-xs hover:bg-blue-50 ${savedProjectId === project.id ? "bg-blue-50 text-blue-700" : "text-slate-700"}`}
                  >
                    {project.whatsappGroupName}
                  </button>
                )) : <p className="px-3 py-3 text-xs text-slate-500">No group names match your search.</p>}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-1 space-y-3">
          <label className="block">
            <span className="sr-only">Manual project name</span>
            <input
              autoFocus
              value={manualName}
              aria-required="true"
              onChange={(event) => { setManualName(event.target.value); setError(""); }}
              placeholder="Enter Project Name..."
              className={inputClass}
            />
          </label>

          <label className="block" htmlFor="create-ap-client-name">
            <span className="mb-1 block text-[10px] font-semibold text-slate-700">Client Name<span aria-hidden="true" className="ml-0.5 text-rose-500">*</span></span>
            <input
              id="create-ap-client-name"
              value={clientName}
              maxLength={191}
              aria-required="true"
              onChange={(event) => { setClientName(event.target.value); setError(""); }}
              placeholder="Client name for the proof link"
              className={inputClass}
            />
          </label>

          <div>
            <label className="mb-1 block text-[10px] font-semibold text-slate-700" htmlFor="create-ap-client-number">
              Client WhatsApp Number<span aria-hidden="true" className="ml-0.5 text-rose-500">*</span>
            </label>
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
                id="create-ap-client-number"
                value={clientNumber}
                inputMode="numeric"
                aria-required="true"
                onChange={(event) => { setClientNumber(event.target.value.replace(/\D/g, "").slice(0, 10)); setError(""); }}
                placeholder="10-digit number"
                className="min-w-0 flex-1 rounded-r-md px-3 text-xs text-slate-700 outline-none placeholder:text-slate-400"
              />
            </div>
          </div>
        </div>
      )}

      <p role={error ? "alert" : undefined} className={`mt-2 min-h-4 text-[10px] ${error ? "text-red-600" : "text-slate-500"}`}>
        {error || (nameMode === "saved"
          ? (!isLoading && groupNames.length === 0
            ? "No unused WhatsApp group names from in-progress projects are available."
            : "The client's name and number come from the selected Sales Manager project.")
          : "The client's name and number are what the proof link is sent to.")}
      </p>

      <div className="mt-2">
        <button type="submit" className="h-8 rounded-md bg-blue-600 px-4 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-300">
          Create Project
        </button>
      </div>
    </form>
  );
}
