"use client";

import Checklist from "@mui/icons-material/Checklist";
import ContentCopy from "@mui/icons-material/ContentCopy";
import OpenInNew from "@mui/icons-material/OpenInNew";
import Refresh from "@mui/icons-material/Refresh";
import Tune from "@mui/icons-material/Tune";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Button from "@/components/shared/Button";
import DateField from "@/components/shared/DateField";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import Loader from "@/components/shared/Loader";
import ToggleSwitch from "@/components/shared/ToggleSwitch";
import useFormErrors from "@/components/shared/useFormErrors";
import { markedFieldsMessage } from "@/lib/formErrors.mjs";
import Dialog from "@/components/ui/Dialog";
import SelectionItemsTable from "./SelectionItemsTable";
import WhatsAppGroupLinkDialog from "./WhatsAppGroupLinkDialog";
import ShootSelectionStatus from "./ShootSelectionStatus";
import { withFolderNames } from "@/lib/shootGroups.mjs";
import { useModuleAccess } from "@/components/auth/PermissionsProvider";
import ReadOnlyFieldset from "@/components/shared/ReadOnlyFieldset";
import {
  addImageSelectionDeliverable,
  getGalleryPublication,
  getImageSelectionSettings,
  getSelectionSummary,
  listImageSelectionDeliverables,
  removeImageSelectionDeliverable,
  publishGallery,
  regeneratePin,
  revokeGallery,
  saveImageSelectionDeliverableOverrides,
  saveImageSelectionProjectSettings,
  unlinkProjectWhatsappGroup,
} from "@/services/image-selection/image-selection.service";
import {
  NEW_SELECTION_ITEM_LIMIT,
  hasSettingsChanges,
  pendingSelectionDrafts,
  projectSettingsState,
  saveThenShare,
  settingsFormState,
  validateSelectionLimit,
} from "@/lib/imageSelectionSettings.mjs";

// Both the stored expiry ("2026-12-15T23:59:59.999Z") and the one the calendar writes
// ("2026-12-15") read as the same day, so the panel never shows two spellings of one date.
const formatDay = (value) => {
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? `${value}T00:00:00` : value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("en-GB");
};

// The switch itself is the shared one; this only adds the label-and-description column beside it.
// The switch is a label wrapping a visually hidden checkbox, so a disabled fieldset makes it inert
// but leaves the part you can actually see styled as if it were live. `disabled` is forwarded so
// ToggleSwitch draws its own refused state on the control itself - not on the row's text.
function Toggle({ label, description, checked, onChange, disabled = false, title }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-xs font-medium text-slate-700">{label}</p>
        <p className="mt-0.5 text-[10px] text-slate-500">{description}</p>
      </div>
      <ToggleSwitch ariaLabel={label} checked={checked} disabled={disabled} onCheckedChange={onChange} className="mt-0.5" title={title} />
    </div>
  );
}
export default function ImageSelectionSettingsPanel({ project, projectDisabled = false, onSaved, onProjectChanged, onProjectUpdated, onViewInvite, rootFolders = [] }) {
  /*
   * One permission for the module: the settings saved here, and publishing the gallery they
   * describe, are the same job.
   *
   * These controls are held shut rather than taken away, which is the exception to the rule the
   * rest of the app follows. A rail that loses half its rows reads as a broken panel, and the
   * settings themselves are worth reading even when they cannot be changed - so they stay on
   * screen, disabled, and the pointer says so on the way past instead of a save failing after
   * somebody has already typed.
   */
  const { canWrite: moduleCanWrite } = useModuleAccess("IMAGE_SELECTION", "Project Management");
  // A project disabled from Expand is read here as it stands: nothing in the rail - publishing, the
  // PIN, the link, the WhatsApp group - can be changed until it is enabled again.
  const canEditSettings = moduleCanWrite && !projectDisabled;
  const readOnlyTitle = projectDisabled ? "This project is disabled. Enable it from Expand to upload photos or send the client link." : "You have read-only access to Image Selection.";
  const [publication, setPublication] = useState(null);
  const [deliverables, setDeliverables] = useState([]);
  // How many photos the client has picked per selection item, for the "10 ✓" beside each name —
  // the same count the desktop's panel shows. Purely informational, so a failed load shows 0s
  // rather than an error.
  const [selectionCounts, setSelectionCounts] = useState({});
  const [settings, setSettings] = useState(null);
  const [initial, setInitial] = useState(null);
  // The selection limits that will not save, keyed by item id; each row says why under itself.
  const fields = useFormErrors();
  const { clearAll: clearErrors } = fields;
  const [message, setMessage] = useState("");
  // The copy buttons' snackbar — the same confirmation the desktop app gives, so copying the
  // Client URL or PIN visibly worked instead of succeeding in silence.
  const { notice, showSuccess, showError, clearNotice } = useNotice();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [activePanel, setActivePanel] = useState("settings");
  // The picker for the project's WhatsApp group, opened from the rail's Link / Change.
  const [groupDialog, setGroupDialog] = useState(false);
  // The studio-wide gallery validity, which is what an unset expiry date falls back to.
  const [validityMonths, setValidityMonths] = useState(6);
  // The table's add rows, held here so Review & Share can add a typed item nobody pressed + for.
  const [drafts, setDrafts] = useState({});
  // Review & Share is saving what is pending; a second press while it runs does nothing.
  const sharingRef = useRef(false);
  const [sharing, setSharing] = useState(false);
  // A folder deleted from the tree has taken its selection items and limits with it on the server.
  // The rail loads its items once, so the deleted folder's items are dropped here the moment the
  // folder leaves the tree - never only after a page reload. Only a folder that WAS listed and is
  // gone counts, so the empty list before the tree first loads drops nothing. Adjusted during
  // render, the same way the workspace applies a folder deep link.
  const rootFolderKey = rootFolders.map((folder) => folder.id).join(",");
  const [listedFolderKey, setListedFolderKey] = useState(rootFolderKey);
  if (rootFolderKey !== listedFolderKey) {
    const current = new Set(rootFolderKey.split(",").filter(Boolean));
    const gone = new Set(listedFolderKey.split(",").filter((id) => id && !current.has(id)));
    setListedFolderKey(rootFolderKey);
    if (gone.size) {
      const removedIds = new Set(deliverables.filter((item) => gone.has(item.shoot?.folderId)).map((item) => item.id));
      if (removedIds.size) {
        const keep = (item) => !removedIds.has(item.id);
        setDeliverables((items) => items.filter(keep));
        setSettings((value) => (value ? { ...value, deliverables: value.deliverables.filter(keep) } : value));
        setInitial((value) => (value ? { ...value, deliverables: value.deliverables.filter(keep) } : value));
      }
      setDrafts((value) => Object.fromEntries(Object.entries(value).filter(([groupId]) => ![...gone].some((id) => groupId === `folder:${id}`))));
    }
  }
  // Always the current project, without making it a reload trigger. Saving hands a refreshed
  // project back up to the page, and reloading the whole panel on that would throw away the
  // values that were just saved and flash the loader over a form the user is still looking at.
  // Only genuinely switching project reloads. The ref is updated in an effect, which still runs
  // before the load below — that is scheduled on a timeout, so it fires after every effect.
  const projectRef = useRef(project);
  useEffect(() => {
    projectRef.current = project;
  }, [project]);
  const load = useCallback(async () => {
    setLoading(true);
    // Settled rather than all: the three calls are independent, and a project with no selection
    // items must still get its validity toggles, client link, PIN and expiry. Failing together
    // used to blank the whole panel and leave one error line in its place.
    const [publicationResult, deliverableResult, settingsResult, summaryResult] = await Promise.allSettled([
      getGalleryPublication(project.id),
      listImageSelectionDeliverables(project.id),
      getImageSelectionSettings(),
      getSelectionSummary(project.id),
    ]);
    setSelectionCounts(summaryResult.status === "fulfilled" ? summaryResult.value.data?.selectionCounts || {} : {});
    const items = deliverableResult.status === "fulfilled" ? deliverableResult.value.data || [] : [];
    // The studio-wide window is what an unset expiry date defaults to, so a studio working to
    // twelve months is offered twelve rather than the shipped six.
    const validityMonths = settingsResult.status === "fulfilled" ? settingsResult.value.data?.galleryValidityMonths ?? 6 : 6;
    setValidityMonths(validityMonths);
    if (publicationResult.status === "fulfilled") setPublication(publicationResult.value.data);
    setDeliverables(items);
    const next = settingsFormState(projectRef.current, items, { validityMonths });
    setSettings(next);
    setInitial(next);
    clearErrors();
    setDrafts({});
    const failure = publicationResult.status === "rejected" ? publicationResult.reason : deliverableResult.status === "rejected" ? deliverableResult.reason : null;
    setMessage(failure ? failure.message || "Unable to load settings." : "");
    setLoading(false);
  }, [clearErrors, project.id]);
  useEffect(() => {
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const dirty = useMemo(
    () => (settings && initial ? hasSettingsChanges(initial, settings) : false),
    [settings, initial],
  );
  // The short public URL the backend built (gallery subdomain in production, /g/<code> locally).
  // The long tokenized path is only a fallback for a publication that predates short codes.
  const clientUrl =
    publication?.clientUrl ||
    (publication?.clientPath && typeof window !== "undefined"
      ? `${window.location.origin}${publication.clientPath}`
      : "");
  // A date chosen in the field but not yet saved, so the expiry reported under the Client URL can
  // say which one is which instead of appearing to contradict the field above it.
  function updateDeliverable(id, patch) {
    setSettings((current) => ({
      ...current,
      deliverables: current.deliverables.map((item) =>
        item.id === id ? { ...item, ...patch } : item,
      ),
    }));
  }
  async function toggleDeliverable(id, enabled) {
    const current = settings.deliverables.find((item) => item.id === id);
    if (!current || current.enabled === enabled) return;
    updateDeliverable(id, { enabled });
    try {
      const savedLimit = initial?.deliverables.find((item) => item.id === id)?.selectionLimit ?? current.selectionLimit;
      // The limit is sent as it stands, not as an override: ticking a checkbox must not pin a number
      // the studio never typed. The backend keeps it following the allocation when it still matches.
      const response = await saveImageSelectionDeliverableOverrides(project.id, [{ configId: id, enabled, selectionLimit: Number(savedLimit) }]);
      setInitial((previous) => ({ ...previous, deliverables: previous.deliverables.map((item) => item.id === id ? { ...item, enabled } : item) }));
      // The saved row is the server's answer — enabled and, after a reopen, the lifted
      // selectionSubmittedAt — so the deliverables the status section and the green checkbox
      // read stay true without this panel re-deriving the backend's reopen rule. The notice
      // fires only on an actual transition: the row was submitted here and the server's answer
      // says it no longer is.
      const savedRow = response?.data?.find?.((row) => row.id === id);
      const wasSubmitted = deliverables.find((item) => item.id === id)?.selectionSubmittedAt;
      if (savedRow) {
        setDeliverables((current) => current.map((item) => (item.id === id ? { ...item, enabled: savedRow.enabled, selectionSubmittedAt: savedRow.selectionSubmittedAt ?? null } : item)));
        if (wasSubmitted && !savedRow.selectionSubmittedAt) showSuccess("Selection reopened — the client can pick photos for this item again.");
      } else {
        setDeliverables((current) => current.map((item) => (item.id === id ? { ...item, enabled } : item)));
      }
      onProjectChanged?.();
    } catch (error) {
      updateDeliverable(id, { enabled: current.enabled });
      showError(error.message || "Unable to save the selection change.");
    }
  }
  // Added and removed one at a time rather than through Save: a selection item is a thing that
  // exists or does not, and the Save button below only carries the limits and checkboxes. Both
  // hand back the project's whole list, so the table and the form state are rebuilt from the
  // server's answer instead of being patched locally.
  function applyItems(items) {
    setDeliverables(items);
    const deliverableState = items.map((item) => ({ id: item.id, enabled: item.enabled, selectionLimit: item.selectionLimit }));
    setSettings((current) => ({ ...current, deliverables: deliverableState }));
    setInitial((current) => ({ ...current, deliverables: deliverableState }));
    clearErrors();
    onProjectChanged?.();
  }
  async function addSelectionItem({ name, selectionLimit, shootName = null, shootFolderId = null }) {
    setBusy(true);
    try {
      const response = await addImageSelectionDeliverable(project.id, { name, selectionLimit: selectionLimit || NEW_SELECTION_ITEM_LIMIT, shootName, shootFolderId });
      applyItems(response.data || []);
      return true;
    } catch (error) {
      showError(error.message || "Unable to add the selection item.");
      return false;
    } finally { setBusy(false); }
  }
  async function removeSelectionItem(item) {
    setBusy(true);
    try {
      const response = await removeImageSelectionDeliverable(project.id, item.id);
      applyItems(response.data || []);
    } catch (error) {
      showError(error.message || "Unable to remove the selection item.");
    } finally { setBusy(false); }
  }
  async function copy(value, label) {
    try {
      await navigator.clipboard.writeText(value);
      showSuccess(`${label} copied.`);
    } catch {
      showError(`Unable to copy the ${label}. Select it manually.`);
    }
  }
  // The limits that will not save, keyed by item id.
  const limitProblems = () => Object.fromEntries(settings.deliverables
    .filter((item) => !validateSelectionLimit(item.selectionLimit))
    .map((item) => [item.id, "Enter a limit between 1 and 100000."]));
  function validateLimits() {
    return fields.check(limitProblems());
  }
  async function save() {
    if (validateLimits()) await persistSettings();
  }
  // True once the settings and limits are stored; false, with the error shown and the edits left
  // in place, when they are not.
  async function persistSettings() {
    setBusy(true);
    try {
      // The client's name and number are not asked for here, so they are left out entirely: the
      // backend reads an absent field as "leave this column alone" rather than as a blank answer.
      const response = await saveImageSelectionProjectSettings(project.id, {
        selectionValidityEnabled: settings.selectionValidityEnabled,
        allowPhotoSelection: settings.allowPhotoSelection,
        selectionValidUntil: settings.selectionValidUntil || "",
      });
      // A project with no Project Management link has no selection items, and the overrides
      // endpoint rejects an empty list, so there is nothing to send.
      if (settings.deliverables.length)
        await saveImageSelectionDeliverableOverrides(
          project.id,
          settings.deliverables.map((item) => ({
            configId: item.id,
            enabled: item.enabled,
            selectionLimit: Number(item.selectionLimit),
          })),
        );
      // Show back what was stored, not what was typed. The number is normalized on the way in,
      // and the page is still holding the project as it looked when it was first opened — so the
      // saved row is handed upward, otherwise the next render would repopulate these fields from
      // that stale copy and blank them.
      const saved = response?.data;
      const next = saved ? { ...settings, ...projectSettingsState(saved, { validityMonths }) } : settings;
      setSettings(next);
      setInitial(next);
      clearErrors();
      // Saving an expiry date moves it on the published link too, and the publication this panel is
      // holding was read before that happened — so it is read again, otherwise "Link expires on"
      // below the Client URL would keep reporting the date the gallery no longer expires on.
      try {
        const refreshed = await getGalleryPublication(project.id);
        setPublication(refreshed.data);
      } catch { /* the settings did save; the line below the URL catches up on the next load */ }
      if (saved) onProjectUpdated?.(saved);
      onSaved?.();
      return true;
    } catch (error) {
      showError(error.message || "Unable to save selections.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function togglePublish() {
    setBusy(true);
    try {
      const result =
        publication?.status === "PUBLISHED"
          ? await revokeGallery(project.id)
          : await publishGallery(project.id);
      setPublication(result.data);
      onProjectChanged?.();
    } catch (error) {
      showError(error.message || "Unable to update publish status.");
    } finally {
      setBusy(false);
    }
  }
  // Review & Share: save whatever is pending - the limits, checkboxes and validity in the form, and
  // any item typed into an add row but never added - then make sure the gallery is published, then
  // open the WhatsApp template so the message is read before it is sent. The template replaces
  // this panel, so nothing may still be unsaved when it opens: a step that fails stops here, with
  // its error shown and the edits still in place.
  async function reviewAndShare() {
    if (sharingRef.current) return;
    sharingRef.current = true;
    setSharing(true);
    const pending = pendingSelectionDrafts(drafts);
    try {
      await saveThenShare({
        validate: () => {
          // Each refused limit says why on its own row; the notice says only how many.
          const badDrafts = pending.filter((draft) => !validateSelectionLimit(draft.selectionLimit)).length;
          const badLimits = Object.keys(limitProblems()).length;
          if (!validateLimits() || badDrafts) {
            setActivePanel("selection");
            showError(markedFieldsMessage(badLimits + badDrafts));
            return false;
          }
          return true;
        },
        save: dirty ? persistSettings : null,
        addDrafts: pending.length ? async () => {
          for (const draft of pending) {
            if (!(await addSelectionItem(draft))) return false;
            setDrafts((current) => ({ ...current, [draft.groupId]: { name: "", limit: "" } }));
          }
          return true;
        } : null,
        publish: publication?.status !== "PUBLISHED" ? async () => {
          setBusy(true);
          try {
            const result = await publishGallery(project.id);
            setPublication(result.data);
            onProjectChanged?.();
            return true;
          } catch (error) {
            showError(error.message || "Unable to publish the gallery.");
            return false;
          } finally {
            setBusy(false);
          }
        } : null,
        open: onViewInvite,
      });
    } finally {
      sharingRef.current = false;
      setSharing(false);
    }
  }
  // Unlinking is one press rather than a dialog: it changes where the *next* invite goes and
  // nothing else, and the group is one press away from being linked again.
  async function unlinkGroup() {
    setBusy(true);
    try {
      const result = await unlinkProjectWhatsappGroup(project.id);
      onProjectUpdated?.(result.data);
      showSuccess("WhatsApp group unlinked.");
    } catch (error) {
      showError(error.message || "Unable to unlink the WhatsApp group.");
    } finally {
      setBusy(false);
    }
  }
  async function rotatePin() {
    setBusy(true);
    try {
      const result = await regeneratePin(project.id);
      setPublication(result.data);
      onProjectChanged?.();
    } catch (error) {
      showError(error.message || "Unable to generate a PIN.");
    } finally {
      setBusy(false);
    }
  }
  if (loading)
    return (
      <aside className="border-l border-slate-200 p-3">
        <Loader label="Loading settings..." size="sm" inline />
      </aside>
    );
  if (!settings)
    return (
      <aside className="border-l border-slate-200 p-3 text-xs text-red-600">
        {message || "Settings unavailable."}
      </aside>
    );
  // A project with no Sales Manager link has no Post Production Allocation behind it, so its
  // selection items are typed here rather than derived. A linked project's table is unchanged.
  const manual = !project.salesProjectId;
  // Shoot groups are headed by their folder's live name, so a rename shows here at once.
  const shownDeliverables = withFolderNames(deliverables, rootFolders);
  // Selection items are added and removed one at a time rather than through Save, so the fieldset
  // has to reach them too - the footer's Save Changes never sees these edits.
  const renderTable = (onExpand) => (
    <ReadOnlyFieldset canWrite={canEditSettings} reason={readOnlyTitle}>
    <SelectionItemsTable
      dense
      deliverables={shownDeliverables}
      selections={settings.deliverables}
      selectionCounts={selectionCounts}
      errors={fields.errors}
      onLimitChange={(id, selectionLimit) => { fields.clear(id); updateDeliverable(id, { selectionLimit }); }}
      onToggle={toggleDeliverable}
      onExpand={onExpand}
      onAdd={manual ? addSelectionItem : undefined}
      onRemove={manual ? removeSelectionItem : undefined}
      adding={busy}
      // A manual project's root folders are its shoots in the client gallery, so they stand as
      // groups here without being typed again. A linked project's shoots come from its allocation.
      folderShoots={manual ? rootFolders : []}
      drafts={drafts}
      onDraftsChange={setDrafts}
    />
    </ReadOnlyFieldset>
  );
  return (
    <>
      <FloatingNotice notice={notice} onClose={clearNotice} />
      <aside className="flex min-h-0 flex-col overflow-hidden border-l border-slate-200 bg-white md:h-full">
        <nav
          aria-label="Settings panel sections"
          className="grid shrink-0 grid-cols-2 border-b border-slate-200"
        >
          <button
            type="button"
            onClick={() => setActivePanel("settings")}
            aria-label="General settings"
            aria-pressed={activePanel === "settings"}
            className={`relative grid h-10 place-items-center text-slate-500 transition hover:bg-slate-50 hover:text-slate-800 ${activePanel === "settings" ? "text-blue-600 after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-blue-600" : ""}`}
          >
            <Tune style={{ fontSize: 16 }} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setActivePanel("selection")}
            aria-label="Selection items"
            aria-pressed={activePanel === "selection"}
            className={`relative grid h-10 place-items-center text-slate-500 transition hover:bg-slate-50 hover:text-slate-800 ${activePanel === "selection" ? "text-blue-600 after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-blue-600" : ""}`}
          >
            <Checklist style={{ fontSize: 16 }} aria-hidden="true" />
          </button>
        </nav>
        <div className="flex min-h-0 flex-1 flex-col p-3">
          {activePanel === "settings" ? (
            // The rail is only as tall as the workspace, and the client fields push the section
            // past it on a short screen, so the settings column scrolls inside itself rather
            // than clipping or making the page scroll.
            <ReadOnlyFieldset canWrite={canEditSettings} reason={readOnlyTitle} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="shrink-0 space-y-4 border-b border-slate-200 pb-3">
            <Toggle
              label="Publish Status"
              description="Disabling this will unpublish the link"
              checked={publication?.status === "PUBLISHED"}
              disabled={!canEditSettings}
              title={canEditSettings ? undefined : readOnlyTitle}
              onChange={togglePublish}
            />
            <Toggle
              label="Allow Photo Selection"
              description="Disabling this will disable the selection option"
              checked={settings.allowPhotoSelection}
              disabled={!canEditSettings}
              title={canEditSettings ? undefined : readOnlyTitle}
              onChange={(value) =>
                setSettings((current) => ({
                  ...current,
                  allowPhotoSelection: value,
                }))
              }
            />
          </div>

          {/* The expiry sits with the link it applies to rather than in a section of its own, so
              the rail keeps one divider between the toggles and the client's link details. */}
          <section className="shrink-0 border-b border-slate-200 py-3">
            <DateField
              label="Expiry Date"
              helperText="The last day the client can make their photo selection."
              value={settings.selectionValidUntil}
              restriction="past"
              className="mb-3 [&_button]:min-h-8 [&_button]:text-[10px]"
              labelClassName="text-[10px] font-bold text-slate-700"
              onChange={(value) =>
                setSettings((current) => ({ ...current, selectionValidUntil: value }))
              }
            />
            <label className="block text-[10px] font-bold text-slate-700">
              Client URL
            </label>
            <div className="mt-1 flex h-8 items-center rounded-md border border-slate-300 px-2">
              <input
                readOnly
                disabled={!clientUrl}
                value={clientUrl}
                placeholder="Publish to create a client URL"
                className="min-w-0 flex-1 bg-transparent text-[10px] text-blue-600 outline-none disabled:cursor-restricted"
              />
              <button
                type="button"
                disabled={!clientUrl}
                onClick={() => copy(clientUrl, "Client URL")}
                className="p-1 disabled:cursor-restricted disabled:opacity-40"
                aria-label="Copy client URL"
              >
                <ContentCopy style={{ fontSize: 13 }} />
              </button>
              <a
                href={clientUrl || undefined}
                target="_blank"
                rel="noreferrer"
                aria-label="Open client URL"
                className={`p-1 ${clientUrl ? "" : "pointer-events-none opacity-40"}`}
              >
                <OpenInNew style={{ fontSize: 13 }} />
              </a>
            </div>
            {/* The date the link actually stops working, which is the stored one — the field above
                only becomes this once it has been saved. */}
            {publication?.status === "PUBLISHED" && publication.expiresAt && (
              <p className="mt-1 text-[10px] text-slate-500">
                Link expires on {formatDay(publication.expiresAt)}
              </p>
            )}
            {/* The same 12px the Expiry Date leaves before the Client URL, so the three fields in
                this section are spaced alike whether or not the expiry line above is showing. */}
            <label className="mt-3 block text-[10px] font-bold text-slate-700">
              Access PIN
            </label>
            <div className="mt-1 flex h-8 items-center rounded-md border border-slate-300 px-2">
              <input
                readOnly
                disabled={!publication?.pin}
                value={publication?.pin || ""}
                placeholder="Publish to generate a PIN"
                className="min-w-0 flex-1 bg-transparent font-mono text-[10px] outline-none disabled:cursor-restricted"
              />
              <button
                type="button"
                disabled={!publication?.pin}
                onClick={() => copy(publication.pin, "PIN")}
                className="p-1 disabled:cursor-restricted disabled:opacity-40"
                aria-label="Copy access PIN"
              >
                <ContentCopy style={{ fontSize: 13 }} />
              </button>
              <button
                type="button"
                disabled={busy || publication?.status !== "PUBLISHED"}
                onClick={rotatePin}
                className="p-1 disabled:cursor-restricted disabled:opacity-40"
                aria-label="Regenerate access PIN"
              >
                <Refresh style={{ fontSize: 13 }} />
              </button>
            </div>
          </section>

          {/* The WhatsApp group the invite is sent into - the group the studio runs with this
              client, picked from the coordinator's own groups with the one named like the project
              suggested. One live project per group; the picker says which are already taken. */}
          <section className="shrink-0 border-b border-slate-200 py-3">
            <p className="text-[10px] font-bold text-slate-700">WhatsApp Group</p>
            <div className="mt-1 flex h-8 items-center gap-1 rounded-md border border-slate-300 px-2">
              <span className={`min-w-0 flex-1 truncate text-[10px] ${project.whatsappGroupSubject ? "text-slate-700" : "text-slate-400"}`}>
                {project.whatsappGroupSubject || "No group linked"}
              </span>
              <button
                type="button"
                disabled={busy || !canEditSettings}
                title={canEditSettings ? undefined : readOnlyTitle}
                onClick={() => setGroupDialog(true)}
                className="rounded px-1.5 py-0.5 text-[10px] text-blue-600 disabled:cursor-restricted disabled:opacity-40"
              >
                {project.whatsappGroupJid ? "Change" : "Link"}
              </button>
              {project.whatsappGroupJid && (
                <button
                  type="button"
                  disabled={busy || !canEditSettings}
                  title={canEditSettings ? undefined : readOnlyTitle}
                  onClick={unlinkGroup}
                  className="rounded px-1.5 py-0.5 text-[10px] text-red-600 disabled:cursor-restricted disabled:opacity-40"
                >
                  Unlink
                </button>
              )}
            </div>
            {project.whatsappGroupLinkedAt && (
              <p className="mt-1 text-[10px] text-slate-500">Linked on {formatDay(project.whatsappGroupLinkedAt)}</p>
            )}
          </section>

          {/* The project's shoots and the selection items under each, with where the client's
              selection stands — the read-at-a-glance answer to "what is in this gallery". */}
          <section className="shrink-0 py-3">
            <p className="mb-1.5 text-[10px] font-bold text-slate-700">Shoots &amp; Selection Items</p>
            <ShootSelectionStatus deliverables={shownDeliverables}selectionCounts={selectionCounts} folderShoots={manual ? rootFolders : []} />
          </section>
            </ReadOnlyFieldset>
          ) : (
            <section className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                {renderTable(() => setExpanded(true))}
              </div>
            </section>
          )}
        </div>
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-200 p-3">
          <button type="button" onClick={onViewInvite} className="text-[10px] text-blue-600">
            View Invite
          </button>
          <div className="flex items-center gap-2">
            {/* Only offered once something has actually changed, so the rail stays quiet the
                rest of the time. Without it the validity toggles and the client details were
                edited into local state and never persisted. */}
            {(dirty || !canEditSettings) && (
              <button
                type="button"
                disabled={busy || sharing || !canEditSettings}
                title={canEditSettings ? undefined : readOnlyTitle}
                onClick={save}
                className="rounded-md bg-blue-600 px-2 py-1.5 text-[10px] font-medium text-white disabled:cursor-restricted disabled:opacity-50"
              >
                {busy ? "Saving..." : "Save Changes"}
              </button>
            )}
            <button
              type="button"
              disabled={busy || sharing || !canEditSettings}
              title={canEditSettings ? undefined : readOnlyTitle}
              onClick={reviewAndShare}
              className="rounded-md bg-blue-50 px-2 py-1.5 text-[10px] font-medium text-blue-600 disabled:cursor-restricted disabled:opacity-50"
            >
              {sharing ? "Saving..." : "Review & Share"}
            </button>
          </div>
        </footer>
      </aside>
      {groupDialog && (
        <WhatsAppGroupLinkDialog
          project={project}
          canWrite={canEditSettings}
          onClose={() => setGroupDialog(false)}
          onLinked={(updated) => { onProjectUpdated?.(updated); showSuccess("WhatsApp group linked."); }}
        />
      )}
      {expanded && (
        <Dialog
          title="Selection Settings"
          size="lg"
          onClose={() => setExpanded(false)}
          footer={<Button type="button" onClick={() => setExpanded(false)}>Close</Button>}
        >
          {renderTable()}
        </Dialog>
      )}
    </>
  );
}
