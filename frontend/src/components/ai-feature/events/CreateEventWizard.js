"use client";

import { useEffect, useMemo, useState } from "react";
import SettingsGroupForm from "@/components/ai-feature/shared/SettingsGroupForm";
import Button from "@/components/shared/Button";
import Loader from "@/components/shared/Loader";
import useUnsavedGuard from "@/components/shared/useUnsavedGuard";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Dialog from "@/components/ui/Dialog";
import { WIZARD_STEPS, detailsProblems } from "@/lib/aiFeature.mjs";
import { createAiEvent, getAiEventDefaults, updateAiEvent } from "@/services/ai-feature/ai-feature.service";
import DetailsStep, { detailsFrom, detailsPayload, eventTypeOf } from "./wizard/DetailsStep";
import ReviewStep from "./wizard/ReviewStep";
import StepRail from "./wizard/StepRail";
import SubEventsStep, { subEventsPayload } from "./wizard/SubEventsStep";

/**
 * Create Event, in six steps, and Edit Event, which is the first of them with Save in place of
 * Next: sub-events and settings are changed inside the event's own workspace once it exists, so
 * the wizard never rewrites them behind that screen's back.
 *
 * The settings steps start from Event Default Settings - the studio's template - and what is
 * changed here becomes this event's own copy. `onCreated(event, { created })` is called with the
 * saved row; the page decides where to go from there.
 */
const EVENT_GROUPS = ["guestAccess", "ai", "media", "gallery", "privacy", "notifications"];
const STEP_GROUPS = { settings: ["gallery", "privacy", "notifications"], guests: ["guestAccess"], ai: ["ai", "media"] };

/** A 400 from the server, as one line: its message and the first thing each refused field says. */
function serverMessage(caught) {
  const fields = caught?.data?.errors?.fieldErrors;
  const lines = fields ? Object.entries(fields).map(([field, messages]) => `${field}: ${messages[0]}`) : [];
  return [caught?.message || "Unable to save the event.", ...lines].join(" ");
}

/** The settings groups as the server takes them: a number field left empty is not sent. */
function settingsPayload(settings) {
  const out = {};
  for (const group of EVENT_GROUPS) {
    if (!settings[group]) continue;
    out[group] = Object.fromEntries(Object.entries(settings[group]).filter(([, value]) => value !== "" && value !== undefined));
  }
  return out;
}

export default function CreateEventWizard({ onClose, onCreated, event = null }) {
  const editing = Boolean(event?.id);
  const steps = editing ? WIZARD_STEPS.slice(0, 1) : WIZARD_STEPS;
  const [defaults, setDefaults] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [details, setDetails] = useState(null);
  const [subEvents, setSubEvents] = useState([]);
  const [settings, setSettings] = useState(null);
  const [step, setStep] = useState(0);
  const [furthest, setFurthest] = useState(0);
  const [problems, setProblems] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const { guard, confirmProps } = useUnsavedGuard(dirty && !saving, { title: "Discard this event?", message: "What has been filled in so far will be lost.", confirmLabel: "Discard", cancelLabel: "Keep editing" });

  // The template the settings steps start from, and the type list and timezone step one offers.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = (await getAiEventDefaults())?.data || {};
        if (cancelled) return;
        setDefaults(data);
        setDetails(detailsFrom(event, data));
        setSettings(Object.fromEntries(EVENT_GROUPS.map((group) => [group, { ...(data[group] || {}) }])));
      } catch (caught) {
        if (!cancelled) setLoadError(caught?.message || "Unable to load the event defaults.");
      }
    })();
    return () => { cancelled = true; };
  }, [event]);

  const eventTypes = defaults?.general?.eventTypes || [];
  const stepId = steps[step]?.[0];
  const dateBounds = useMemo(() => ({ min: details?.startDate || "", max: details?.endDate || details?.startDate || "" }), [details?.startDate, details?.endDate]);

  // The type is two fields in the form and one in the refusals, so either one clears `eventType`.
  const problemKey = (name) => (name === "typeChoice" || name === "customType" ? "eventType" : name);
  const changeDetail = (name, value) => {
    setDirty(true);
    setDetails((current) => ({ ...current, [name]: value }));
    setProblems((current) => (current[problemKey(name)] ? { ...current, [problemKey(name)]: undefined } : current));
  };
  const changeSubEvents = (rows) => { setDirty(true); setSubEvents(rows); };
  const changeSetting = (group, key, value) => { setDirty(true); setSettings((current) => ({ ...current, [group]: { ...current[group], [key]: value } })); };

  /** Step one's refusals, if any, shown on the fields and blocking the way forward. */
  function detailsRefused() {
    const found = detailsProblems({ ...details, eventType: eventTypeOf(details) });
    setProblems(found);
    return Object.keys(found).length > 0;
  }
  function goTo(index) {
    if (index > step && stepId === "details" && detailsRefused()) return;
    setError("");
    setStep(index);
    setFurthest((current) => Math.max(current, index));
  }

  async function submit() {
    if (detailsRefused()) { setStep(0); return; }
    setSaving(true); setError("");
    try {
      const saved = editing
        ? (await updateAiEvent(event.id, detailsPayload(details)))?.data
        : (await createAiEvent({ ...detailsPayload(details), subEvents: subEventsPayload(subEvents), settings: settingsPayload(settings) }))?.data;
      setDirty(false);
      onCreated(saved, { created: !editing });
    } catch (caught) {
      setError(serverMessage(caught));
      setSaving(false);
    }
  }

  const close = () => guard(onClose);
  const last = step === steps.length - 1;
  const ready = Boolean(details && settings);

  return <>
    <Dialog
      title={editing ? "Edit Event" : "Create Event"}
      description={editing ? "Sub-events and settings are changed inside the event." : undefined}
      size="form"
      height="tall"
      busy={saving}
      onClose={close}
      bodyClassName="pb-4"
      footer={<>
        <Button type="button" className="max-sm:flex-1" onClick={close} disabled={saving}>Cancel</Button>
        {step > 0 && <Button type="button" className="max-sm:flex-1" onClick={() => goTo(step - 1)} disabled={saving}>Back</Button>}
        {last
          ? <Button type="button" variant="primary" className="max-sm:flex-1" onClick={submit} disabled={saving || !ready}>{saving ? "Saving..." : editing ? "Save" : "Create Event"}</Button>
          : <Button type="button" variant="primary" className="max-sm:flex-1" onClick={() => goTo(step + 1)} disabled={!ready}>Next</Button>}
      </>}
    >
      {loadError
        ? <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{loadError}</p>
        : !ready
          ? <Loader label="Loading event defaults..." />
          : <div className="flex flex-col gap-4 md:flex-row md:gap-6">
            {steps.length > 1 && <StepRail steps={steps} current={step} furthest={furthest} onSelect={goTo} problems={Object.keys(problems).length ? { details: true } : {}} />}
            <div className="min-w-0 flex-1">
              <h3 className="mb-3 text-sm font-semibold text-slate-800 md:hidden">{steps[step][1]}</h3>
              {stepId === "details" && <DetailsStep details={details} onChange={changeDetail} problems={problems} eventTypes={eventTypes} existingCoverUrl={event?.coverUrl} />}
              {stepId === "subEvents" && <SubEventsStep rows={subEvents} onChange={changeSubEvents} dateBounds={dateBounds} />}
              {(stepId === "settings" || stepId === "guests" || stepId === "ai") && <div className="space-y-4">
                <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">These start from Event Default Settings. What is changed here applies to this event only; the defaults stay as they are.</p>
                <SettingsGroupForm values={settings} onChange={changeSetting} groups={STEP_GROUPS[stepId]} />
              </div>}
              {stepId === "review" && <ReviewStep details={details} subEvents={subEvents} settings={settings} existingCoverUrl={event?.coverUrl} />}
              {error && <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
            </div>
          </div>}
    </Dialog>
    <ConfirmDialog {...confirmProps} layer="confirmOverDialog" />
  </>;
}
