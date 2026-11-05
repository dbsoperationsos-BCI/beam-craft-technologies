"use client";

import { useCallback, useRef, useState } from "react";
import Button from "@/components/shared/Button";
import Dropdown from "@/components/shared/Dropdown";
import HrmOptionListEditor from "@/components/shared/HrmOptionListEditor";
import useUnsavedGuard from "@/components/shared/useUnsavedGuard";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { SIDEBAR_MODULES } from "@/constants/navigation.mjs";
import { fieldListsForScreen } from "@/constants/moduleFieldLists";
import VerticalScopedListEditor from "@/components/settings/VerticalScopedListEditor";
import QuotationShootTypeEditor from "./QuotationShootTypeEditor";

/**
 * The answers a screen's form fields offer.
 *
 * This lived inside Table Settings, reached by picking Human Resource Management from its Module
 * dropdown - which put two unrelated jobs behind one entry. Table Settings builds *new fields* onto
 * a vertical's lead form: it has a field palette, a canvas, a preview and a Save. This edits the
 * *values an existing field offers* - the designations an employee can hold, the departments there
 * are. Its edits are held until Save and thrown away by Cancel, the way Table Settings holds its
 * canvas - so this panel tells the rail when it is holding something, and its own pickers ask
 * before they drop it. There is still nothing to *preview*: a list of answers is what it is.
 *
 * ── Three questions, and the first two are the sidebar's ──────────────────────────────────────
 *
 * Module, then screen, then field: the same path a person walks in the hamburger to reach the page
 * the answers appear on. Which is why the first two pickers are not written down here at all - they
 * are `SIDEBAR_MODULES`, the canonical registry the hamburger, Sidebar Layout and Role Management
 * all draw from. A module or a screen added there shows up in these pickers with nothing changed in
 * this file, and a module renamed is renamed here too.
 *
 * It replaced a single Module picker over `OS_MODULES` - a separate list, in a different order,
 * with entries the sidebar does not have (`sales-manager`, `booking-converts`, `technical`) and
 * missing ones it does. Two answers to "what are this application's modules", which is exactly the
 * drift the registry exists to close. Table Settings asks the same first two questions from the
 * same registry now, and `OS_MODULES` is gone with it - the two screens in this section walk one
 * path, and there is one answer to what the modules are.
 *
 * Every module and every screen is offered, including the many that have no editable answers, so
 * this picker and the hamburger describe the same application. A screen with none says so.
 */

/*
 * The registry rows as the pickers want them.
 *
 * Both are handed to the picker `sorted={false}`. `Dropdown` alphabetises by default so the same
 * values read the same way wherever they are offered, which is right for a list of names and wrong
 * for these two: the sidebar registry *has* an order, it is the order of the hamburger, and the
 * whole point of reading it here is that this screen walks the same path. Alphabetising put
 * Accounts first and Employee Attendance above Employee Repository, which is not what anybody sees
 * in the menu. The Field picker below keeps the default: those are plain names with no order of
 * their own.
 */
const MODULE_OPTIONS = SIDEBAR_MODULES.map((group) => ({ value: group.id, label: group.title }));
const screensOf = (moduleId) => (SIDEBAR_MODULES.find((group) => group.id === moduleId)?.items || []);

export default function FieldSettingsPanel({ onError, unsavedRef }) {
  const [moduleId, setModuleId] = useState("");
  const [screenId, setScreenId] = useState("");
  const [listId, setListId] = useState("");

  const screens = screensOf(moduleId);
  const lists = fieldListsForScreen(screenId);
  // Each picker is on screen but inert until the one before it is answered, the way Table Settings
  // shows the order its questions must be answered in rather than leaving it to be found by
  // clicking. `listEnabled` is false for a screen that simply has no answers to set up.
  const screenEnabled = screens.length > 0;
  const listEnabled = lists.length > 0;
  const activeList = listEnabled ? lists.find((item) => item.value === listId) : null;
  // The list on screen is one the standard editor stages. The quotation's shoots draw their own
  // screen and save as they are typed, so the pair above belongs to neither them nor an empty panel.
  const stagedList = Boolean(activeList) && activeList.editor !== "quotation-shoot-types";
  const moduleLabel = MODULE_OPTIONS.find((item) => item.value === moduleId)?.label;
  const screenLabel = screens.find((item) => item.id === screenId)?.label;

  /*
   * The three pickers throw the staged list away as completely as the settings rail does - the
   * editor is remounted per list, so answering any of them differently drops whatever is waiting to
   * be saved. Read through a function rather than a value: the answer lives in a ref the editor
   * writes, and a ref read during render is read before the click that matters.
   */
  const { guard: guardPickerChange, confirmProps: pickerConfirmProps } = useUnsavedGuard(() => Boolean(unsavedRef?.current));

  /*
   * The staged list's own Cancel and Save, drawn on the picker row above it rather than by the
   * editor itself - where Table Settings keeps the same pair, and the reason this panel holds
   * anything about the list at all. `listControls` is only ever read at the click, so it carries the
   * editor's current closures; `stagedState` is what the two buttons are lit or greyed by.
   */
  const listControls = useRef(null);
  const [stagedState, setStagedState] = useState({ dirty: false, busy: false });
  // Stable, or the editor's effect would publish on every render of this panel.
  const handleStagedChange = useCallback((state) => setStagedState(state), []);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Wraps rather than scrolls: three pickers do not fit a phone in one line, and the shell's
          panes are what scroll. */}
      <div className="flex flex-wrap items-end gap-4 border-b border-slate-200 bg-white px-5 py-4 sm:px-6">
        <Dropdown
          mode="input"
          label="Module"
          ariaLabel="Module"
          placeholder="Select module"
          value={moduleId}
          onChange={(value) => guardPickerChange(() => {
            setModuleId(value);
            // A screen belongs to the module it was picked under and a list to the screen, so
            // changing module clears both rather than carrying a Designations selection onto
            // Accounts, where it means nothing.
            setScreenId("");
            setListId("");
          })}
          options={MODULE_OPTIONS}
          sorted={false}
          className="w-full sm:w-[17rem]"
        />
        <Dropdown
          mode="input"
          label="Screen"
          ariaLabel="Screen"
          placeholder={screenEnabled ? "Select screen" : "Select a module first"}
          value={screenId}
          disabled={!screenEnabled}
          onChange={(value) => guardPickerChange(() => {
            setScreenId(value);
            setListId("");
          })}
          options={screens.map((item) => ({ value: item.id, label: item.label }))}
          sorted={false}
          className="w-full sm:w-[15rem]"
        />
        <Dropdown
          mode="input"
          label="Field"
          ariaLabel="Field"
          placeholder={!screenId ? "Select a screen first" : listEnabled ? "Select field" : "No fields on this screen"}
          value={listId}
          disabled={!listEnabled}
          onChange={(value) => guardPickerChange(() => setListId(value))}
          options={lists.map((item) => ({ value: item.value, label: item.label }))}
          className="w-full sm:w-[15rem]"
        />
        {/* Cancel and Save at the end of the picker row, which is where Table Settings puts its
            own pair. Drawn only for a list that stages its edits - the quotation's shoot types
            write each change as it is made and have nothing for either button to act on. */}
        {stagedList && <div className="ml-auto flex flex-wrap items-center gap-3">
          <Button type="button" variant="secondary" disabled={stagedState.busy || !stagedState.dirty} onClick={() => listControls.current?.cancel()}>
            Cancel
          </Button>
          <Button type="button" variant="primary" disabled={stagedState.busy || !stagedState.dirty} onClick={() => void listControls.current?.save()}>
            {stagedState.busy ? "Saving..." : "Save"}
          </Button>
        </div>}
      </div>

      {activeList ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          {/* Adds, renames and removals are held on the editor's own staged copy and written
              together by its Save, with Cancel to put the list back. */}
          {/* Most lists are one flat set of answers and use the standard editor. A list that says
              which `editor` it wants draws that instead: the quotation's shoots are per brand and
              need a tab each, and the answer for Dum Dum is not the answer for Qua Qua. */}
          {/* A list kept per vertical - the quotation's Categories - gets a tab per brand over the
              same staged editor, with the same Save and Cancel on the picker row. */}
          {activeList.editor === "quotation-shoot-types" ? <QuotationShootTypeEditor onError={onError} /> : activeList.scopedBy === "vertical" ? <VerticalScopedListEditor
            key={activeList.value}
            list={activeList}
            guardChange={guardPickerChange}
            staged
            unsavedRef={unsavedRef}
            controlsRef={listControls}
            onStagedChange={handleStagedChange}
            behaviours={activeList.behaviours}
            onError={onError}
          /> : <HrmOptionListEditor
            /* Remounts on the list being changed, so the staged copy belongs to the list on screen
               and can never be carried onto the next one. */
            key={activeList.value}
            resource={activeList.value}
            label={activeList.label}
            singular={activeList.singular}
            /* Held until Save, with Cancel to put it back - the arrangement Table Settings has, and
               the reason this panel now reports unsaved work to the rail. The quotation's shoot
               types pass nothing and go on saving each change as it is made. */
            staged
            unsavedRef={unsavedRef}
            /* Both halves of the pair on the picker row above: the handlers it presses, and the
               dirty/busy flags it is lit and greyed by. */
            controlsRef={listControls}
            onStagedChange={handleStagedChange}
            /* Most lists are names and nothing else. A few carry behaviour on the row - which
               category closes a payment schedule, which payment mode asks for a reference - and
               those say so here so the studio can rename them without breaking what they do. */
            behaviours={activeList.behaviours}
            onError={onError}
          />}
        </div>
      ) : (
        <div className="px-5 py-10 sm:px-6">
          <p className="rounded-xl border border-dashed border-slate-300 bg-white px-5 py-12 text-center text-sm text-slate-500">
            {!moduleId
              ? "Pick a module, then one of its screens, to set up the answers its fields offer."
              : !screenId
                ? `Pick one of ${moduleLabel}'s screens.`
                : !listEnabled
                  ? `${screenLabel || "This screen"} has no fields whose answers are set up here.`
                  : "Pick a field to set up the answers it offers."}
          </p>
        </div>
      )}

      {/* The question the pickers ask before they drop a staged list, in the rail's own words. */}
      <ConfirmDialog {...pickerConfirmProps} />
    </div>
  );
}
