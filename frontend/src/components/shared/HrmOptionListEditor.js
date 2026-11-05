"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import Button from "@/components/shared/Button";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import Dropdown from "@/components/shared/Dropdown";
import MultiSelectField from "@/components/shared/MultiSelectField";
import TextField from "@/components/shared/TextField";
import OptionsMenu from "@/components/ui/OptionsMenu";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { getMasterData, saveMasterData, deleteMasterData } from "@/services/hrm/master-data.service";
import { layers } from "@/constants/layers";

/**
 * One of the HRM lists - Designations, Departments, Verticals, Skills - as Table Settings edits it.
 *
 * The Leads module's table settings build the *fields* a form carries. HRM's do not: an employee's
 * form has fixed fields, and what varies is the set of answers four of them offer. So picking Human
 * Resource Management and then one of its four lists shows that list's entries, already filled in,
 * with a box to add another - the same shape of question the Leads builder asks, against the thing
 * that actually varies here.
 *
 * It reads and writes the lists HR already maintains (`/api/hrm/<resource>`), so a designation added
 * here is the same designation the employee form offers and the one Employee Settings shows beside
 * it. There is no second store and nothing to keep in step.
 *
 * Every change saves as it is made, which is how the lists behave in Employee Settings; there is no
 * Save button to leave a person wondering whether the last one counted.
 *
 * Unless it is `staged`, which Field Settings passes and the quotation's shoot types do not. Then
 * every edit is held on a copy and written by a Save of its own, with Cancel to put the list back -
 * the arrangement Table Settings has, asked for so the two sections of the Overall group behave
 * alike. The snackbar still answers, for the same reason it does below: a Save that was refused and
 * one that was written must not look the same.
 *
 * Which is exactly why each one says so. A screen with no Save has nothing to press and nothing to
 * go grey, so an entry that was added and an entry that was refused looked identical: the box
 * cleared either way. Every action answers on the application's own snackbar now - the same
 * `FloatingNotice` Employee Settings raises for the same four lists, worded the same way, so the two
 * ways into these lists behave alike.
 *
 * `onError` is kept for the one thing that is not an action: a list that could not be *loaded*
 * describes the state of the whole section rather than something somebody just did, and belongs on
 * the panel's own notice line where it stays put rather than on a bar that fades after five seconds.
 */
/*
 * Where the rows come from and go.
 *
 * The HRM master data by default, which is what every list on this screen was when it was written.
 * `api` is how a list that lives somewhere else borrows the same editor rather than growing a second
 * one beside it: the quotation brands keep their shoots on the brand, not in the master data, and
 * a screen offering Add, rename, remove and a search over a named list is the same screen either
 * way. Four calls, the shape the master data already answers in.
 */
/*
 * What a staged row's id starts with before the server has given it one.
 *
 * A string, and one no id from the server can collide with: these ids are the React keys and what
 * the rename and delete rows are matched by, so a new row needs one from the moment it is typed.
 */
const NEW_ROW_PREFIX = "new:";

const masterDataApi = {
  list: (resource) => getMasterData(resource),
  add: (resource, name) => saveMasterData(resource, { name }),
  rename: (resource, id, name) => saveMasterData(resource, { name }, id),
  remove: (resource, id) => deleteMasterData(resource, id),
  // Setting what a row *does*, as opposed to what it is called. The same PATCH a rename goes
  // through, carrying the field instead of the name - see `behaviours` on the component below.
  setFlag: (resource, id, field, value) => saveMasterData(resource, { [field]: value }, id),
};

/*
 * `behaviours` - the lists that decide something as well as name it.
 *
 * Most of these lists are answers and nothing more: a department is a word on an employee's record.
 * A few decide something. Which payment schedule category closes the schedule, which payment mode
 * asks for a transaction reference - those used to be the *names*, compared against as literal
 * strings, which is precisely why they could not be edited: renaming "Final Settlement" stopped the
 * schedule closing. The meaning sits on the row now, and this is where the studio sets it.
 *
 * Asked as a question about the whole list rather than ticked on each row, which is the difference
 * between a screen somebody can read and a screen showing its own wiring. A tick per row also said
 * the wrong thing: it offered "closes the schedule" on all four categories at once, when only ever
 * one of them may. So the question carries the rule - `mode: "one"` is a single choice, `"many"` a
 * set - and the answer is a sentence about the list instead of a column of switches.
 *
 * Given as `[{ field, mode, question, summary, hint }]`. A list that passes none - which is all
 * twelve HRM ones - looks and behaves exactly as it did.
 */
export default function HrmOptionListEditor({ resource, label, singular, onError, api = masterDataApi, behaviours = [], staged = false, unsavedRef, controlsRef, onStagedChange }) {
  const { notice, showSuccess, showError, clearNotice } = useNotice();
  const [records, setRecords] = useState([]);
  /*
   * The staged copy, and the whole of what `staged` means: every edit is made here and nothing is
   * written until Save, which is the shape Table Settings has and the shape Field Settings was
   * asked for. `records` stays exactly what the server last said, so Cancel is a copy back and Save
   * is the difference between the two - no list of operations to keep in step with the rows.
   *
   * Empty and unused when `staged` is false, which is how the other caller of this editor - the
   * quotation's shoot types - goes on saving each change as it is made.
   */
  const [working, setWorking] = useState([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(null);
  // The row being renamed, and the name being typed into it. One at a time: two rows in edit at
  // once is two half-finished names and no way to tell which Save belongs to which.
  const [editing, setEditing] = useState(null);
  const [query, setQuery] = useState("");
  // Counts the rows added since this list was loaded, so each gets an id of its own to be keyed,
  // renamed and removed by before Save gives it a real one.
  const nextNewId = useRef(0);

  const load = useCallback(async () => {
    /*
     * The rows are cleared as the fetch starts, not in the effect that triggers it - the previous
     * list would otherwise sit under the new heading for as long as the fetch takes, reading as the
     * wrong answer rather than as a wait.
     */
    setRecords([]);
    setWorking([]);
    setLoading(true);
    try {
      const response = await api.list(resource);
      const rows = Array.isArray(response?.data) ? response.data : [];
      setRecords(rows);
      // The staged copy starts as what the server said, so nothing reads as edited on arrival.
      setWorking(rows.map((row) => ({ ...row })));
    } catch (error) {
      onError?.(error?.message || `Unable to load the ${label.toLowerCase()}.`);
    } finally {
      setLoading(false);
    }
  }, [api, label, onError, resource]);

  /*
   * Reloaded whenever the chosen list changes. Deferred a tick, which is this codebase's convention
   * for a first load: a fetch started straight from an effect body counts as state set during it,
   * and React warns about the cascading render that causes - which is why the two resets below sit
   * in the callback rather than in an effect body of their own.
   *
   * They belong to the list being left. A search left over from Departments would hide most of
   * Designations the moment the Field dropdown moved, and read as a list with hardly anything in it
   * rather than as a filter nobody cleared; a half-typed rename would be pointing at a row from the
   * other list entirely.
   */
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery("");
      setEditing(null);
      void load();
    }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  /*
   * Filtered here rather than through the endpoint's own `search`.
   *
   * The whole list is already loaded - these are option lists, tens of entries rather than
   * thousands - so matching in the browser answers on the keystroke instead of on a round trip, and
   * a list being searched cannot flicker through a loading state. Matched on the name because the
   * name is the only thing this screen shows: the code behind it is a machine key nobody here has
   * seen, and offering to search it would be offering to search something invisible.
   */
  /*
   * What the screen is a view of: the staged copy where edits are held, and the server's own rows
   * everywhere else. Everything below reads `rows` rather than `records`, so the list, the search,
   * the count and the questions above them all describe the same thing the buttons act on.
   */
  const rows = staged ? working : records;

  /*
   * Whether anything is staged, by comparing the copy against what the server said rather than by
   * setting a flag in each action - a flag set in three places is a flag one of them forgets, and
   * an edit typed back to its original value would go on claiming to be unsaved.
   */
  const dirty = staged && JSON.stringify(working) !== JSON.stringify(records);

  /*
   * Published upward so the settings rail asks before it unmounts this section, the same way Table
   * Settings does. Cleared on the way out: the staged copy goes with the screen, so a panel that has
   * been unmounted must stop claiming to hold work that no longer exists.
   */
  useEffect(() => {
    if (!unsavedRef) return undefined;
    unsavedRef.current = dirty;
    return () => { unsavedRef.current = false; };
  }, [dirty, unsavedRef]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((record) => String(record.name || "").toLowerCase().includes(needle));
  }, [query, rows]);
  const searching = Boolean(query.trim());

  /*
   * Every entry's name, for the questions above the list.
   *
   * `records` rather than `shown`: a question is about the whole list, so narrowing the search box
   * must not quietly narrow what can answer it - and worked out once here rather than inside each
   * picker, which is also what keeps the rows below the only thing drawn from `records.map`.
   */
  const entryNames = useMemo(() => rows.map((record) => record.name), [rows]);

  /** A row that only exists on screen yet. The prefix is what `save` sorts the new from the kept by. */
  const isNew = (record) => String(record.id ?? "").startsWith(NEW_ROW_PREFIX);

  async function add() {
    const value = name.trim();
    if (!value || busy) return;
    if (staged) {
      // Refused here rather than at Save, where it would be one failure among several and would
      // name a row the person typed several edits ago.
      if (rows.some((record) => String(record.name || "").trim().toLowerCase() === value.toLowerCase())) {
        showError(`${value} is already in ${label}.`);
        return;
      }
      setWorking((current) => [...current, { id: `${NEW_ROW_PREFIX}${nextNewId.current += 1}`, name: value }]);
      setName("");
      setQuery("");
      return;
    }
    setBusy(true);
    try {
      await api.add(resource, value);
      setName("");
      /*
       * The search is cleared by an add, so the entry just made is on screen.
       *
       * Otherwise adding "Branch Partner" while the box holds "manager" refreshes the list and shows
       * no sign of it - the add worked, the filter hid it, and the two are indistinguishable from a
       * button that did nothing.
       */
      setQuery("");
      await load();
      showSuccess(`${value} added to ${label}.`);
    } catch (error) {
      showError(error?.message || `Unable to add that ${singular.toLowerCase()}.`);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Renaming, through the same endpoint that created it.
   *
   * The employees recorded against this entry hold its **text**, not its id - which is the opposite
   * of what this comment used to claim, and the reason renaming used to strand them: the row changed
   * and every employee stayed on the old word, with nothing to say so. The server carries the rename
   * through to those records in the same transaction now, and says how many it moved.
   */
  async function rename() {
    const value = String(editing?.name ?? "").trim();
    if (!value || busy) return;
    if (staged) {
      if (rows.some((record) => record.id !== editing.id && String(record.name || "").trim().toLowerCase() === value.toLowerCase())) {
        showError(`${value} is already in ${label}.`);
        return;
      }
      setWorking((current) => current.map((record) => (record.id === editing.id ? { ...record, name: value } : record)));
      setEditing(null);
      return;
    }
    setBusy(true);
    try {
      const previous = records.find((record) => record.id === editing.id)?.name || "";
      const response = await api.rename(resource, editing.id, value);
      setEditing(null);
      await load();
      /*
       * Both names, because a rename is the one change where what it *was* is the useful half - and
       * the server's own sentence after it where there was one, because rewriting this word on
       * somebody's employee record is not something to do silently.
       */
      const renamed = previous && previous !== value ? `${previous} renamed to ${value}.` : `${value} saved.`;
      showSuccess(response?.message ? `${renamed} ${response.message}` : renamed);
    } catch (error) {
      showError(error?.message || `Unable to rename that ${singular.toLowerCase()}.`);
    } finally {
      setBusy(false);
    }
  }

  /** Which entries currently answer a question - one name for `one`, a list of them for `many`. */
  function answerTo(behaviour) {
    const holders = rows.filter((record) => record[behaviour.field]).map((record) => record.name);
    return behaviour.mode === "one" ? (holders[0] || "") : holders;
  }

  /**
   * Answering one of the questions above the list.
   *
   * The answer is a set of names, so what is written is the difference between it and what the rows
   * say now. Setting comes before clearing, deliberately: a question that must always have an
   * answer - which category closes a schedule - is then never, even for one request, answered by
   * nothing, which is a state the server refuses and the booking form could not work in.
   *
   * Saved as it is answered, like everything else on this screen, and the list is reloaded rather
   * than the answer being kept locally: what comes back is what the server accepted.
   */
  async function answerQuestion(behaviour, answer) {
    if (busy || !api.setFlag) return;
    const wanted = behaviour.mode === "one" ? (answer ? [answer] : []) : answer;
    if (staged) {
      // Staged onto the rows themselves, so `answerTo` reads the answer back from the same copy the
      // list is drawn from and `save` finds it as a difference like any other.
      setWorking((current) => current.map((record) => ({ ...record, [behaviour.field]: wanted.includes(record.name) })));
      return;
    }
    const toSet = records.filter((record) => wanted.includes(record.name) && !record[behaviour.field]);
    const toClear = records.filter((record) => !wanted.includes(record.name) && record[behaviour.field]);
    if (!toSet.length && !toClear.length) return;

    setBusy(true);
    try {
      for (const record of toSet) await api.setFlag(resource, record.id, behaviour.field, true);
      for (const record of toClear) await api.setFlag(resource, record.id, behaviour.field, false);
      await load();
      showSuccess(behaviour.mode === "one"
        ? `${answer} ${behaviour.summary}.`
        : `Saved — ${wanted.length ? wanted.join(", ") : "nothing"} ${behaviour.summary}.`);
    } catch (error) {
      showError(error?.message || `Unable to change what this ${singular.toLowerCase()} does.`);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Writes everything that is staged, as the difference between the copy and the server's rows.
   *
   * The order is the whole of why this is not a loop over a list of edits. Removals go first so a
   * name they free can be taken in the same Save; renames next; additions last, for the same reason.
   * The flags come after a reload, matched by **name**, because a row added moments ago has no id
   * here to set a flag against - and by then the reload has given it one.
   *
   * A refusal stops the rest. The server is the only thing that knows a designation is on forty
   * employee records, and it refuses that removal by name; there is no way to ask it in advance and
   * no sense in writing the edits after it and leaving the list half-moved. What was written stays
   * written - the reload below is what puts the screen back on the truth - and the refusal is shown
   * saying which entry it was about.
   */
  async function save() {
    if (busy || !dirty) return;
    const removed = records.filter((record) => !working.some((row) => row.id === record.id));
    const renamed = working.filter((row) => {
      const before = records.find((record) => record.id === row.id);
      return before && before.name !== row.name;
    });
    const added = working.filter(isNew);

    setBusy(true);
    try {
      for (const record of removed) await api.remove(resource, record.id);
      for (const row of renamed) await api.rename(resource, row.id, row.name);
      for (const row of added) await api.add(resource, row.name);

      // Back on the server's own rows, which is what the flags below are set against and what the
      // screen shows from here whether or not there are any.
      const response = await api.list(resource);
      const fresh = Array.isArray(response?.data) ? response.data : [];

      if (behaviours.length && api.setFlag) {
        const wantedFor = new Map(working.map((row) => [row.name, row]));
        for (const behaviour of behaviours) {
          for (const record of fresh) {
            const wanted = Boolean(wantedFor.get(record.name)?.[behaviour.field]);
            if (wanted !== Boolean(record[behaviour.field])) {
              await api.setFlag(resource, record.id, behaviour.field, wanted);
              record[behaviour.field] = wanted;
            }
          }
        }
      }

      setRecords(fresh);
      setWorking(fresh.map((row) => ({ ...row })));
      setQuery("");
      setEditing(null);
      const counted = [
        added.length && `${added.length} added`,
        renamed.length && `${renamed.length} renamed`,
        removed.length && `${removed.length} removed`,
      ].filter(Boolean);
      showSuccess(counted.length ? `${label} saved - ${counted.join(", ")}.` : `${label} saved.`);
    } catch (error) {
      // What actually landed, rather than what was asked for: some of it may have been written
      // before the refusal, and the screen has to show which.
      await load();
      showError(error?.message || `Unable to save ${label.toLowerCase()}.`);
    } finally {
      setBusy(false);
    }
  }

  /** Throws the staged copy away and goes back to the server's rows. Nothing was written to undo. */
  function cancel() {
    if (busy) return;
    setWorking(records.map((row) => ({ ...row })));
    setEditing(null);
    setName("");
  }

  /*
   * Handing Cancel and Save to whoever drew the pickers, so the pair sits on that row rather than
   * beside the Add box - the arrangement Table Settings has.
   *
   * The two halves travel differently, and that is the point. The **functions** go through a ref,
   * rewritten on every render, because `save` reads the staged copy out of its closure: held in
   * state they would be whatever they were when the flags last changed, and a Save pressed after
   * three more edits would write the list as it stood before them. The **flags** go through a
   * callback into the caller's state, because a ref cannot make a button go grey.
   */
  // No dependency list, so this runs after every render and the handlers behind the buttons are
  // never a render behind the copy they write.
  useEffect(() => {
    if (staged && controlsRef) controlsRef.current = { save, cancel };
  });
  useEffect(() => {
    if (!staged || !onStagedChange) return undefined;
    onStagedChange({ dirty, busy });
    // Nothing staged is what an unmounted list holds, so the pair goes quiet rather than staying lit
    // over the next one.
    return () => onStagedChange({ dirty: false, busy: false });
  }, [staged, onStagedChange, dirty, busy]);

  async function remove(record) {
    if (staged) {
      setWorking((current) => current.filter((row) => row.id !== record.id));
      setDeleting(null);
      return;
    }
    setBusy(true);
    try {
      await api.remove(resource, record.id);
      setDeleting(null);
      await load();
      showSuccess(`${record.name} removed from ${label}.`);
    } catch (error) {
      showError(error?.message || `Unable to remove that ${singular.toLowerCase()}.`);
    } finally {
      setBusy(false);
    }
  }

  return <div className="space-y-4">
    {/* Portalled to the body by `FloatingNotice`, so it is not clipped by the section's own
        scrolling and reads as the application's snackbar rather than as part of this list. */}
    <FloatingNotice notice={notice} onClose={clearNotice} />
    {/* A row, not a form: this is drawn inside the settings panel's own form, and a form cannot
        contain another. Enter is handled here instead. */}
    <div className="flex flex-wrap items-end gap-3">
      <TextField
        label={`Add ${singular}`}
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void add(); } }}
        placeholder={`New ${singular.toLowerCase()}`}
        disabled={busy}
        className="w-[16rem]"
      />
      {/* Add is the only action on this row again, now the pair has gone up to the pickers, so it
          keeps the primary weight it has always had. It never reads "Saving..." on a staged list:
          nothing is being written when it is pressed, and the word belongs to that list's own Save. */}
      <Button type="button" variant="primary" disabled={busy || !name.trim()} onClick={() => void add()}>
        {!staged && busy ? "Saving..." : "Add"}
      </Button>
      {/* No Cancel or Save here. A staged list hands both to whoever drew the pickers above it, so
          they sit on that row where Table Settings keeps its own pair, rather than beside the Add
          box. See `controlsRef` and `onStagedChange`. */}
    </div>

    {/* What this list decides, above the list it decides it about.
        Only the few lists that decide anything draw it; the rest go straight from Add to the list.
        Each question names the entries by the names the list shows, so answering it and reading it
        are the same words - and a rename carries the answer with it, because the answer is the row.
        Two per line from `sm` up and one per line below it, so a three-question list is not three
        squeezed columns at 360px. */}
    {behaviours.length > 0 && <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 sm:px-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {behaviours.map((behaviour) => <div key={behaviour.field} className="min-w-0">
          {behaviour.mode === "one"
            ? <Dropdown
              label={behaviour.question}
              value={answerTo(behaviour)}
              onChange={(value) => void answerQuestion(behaviour, value)}
              // The list's own order, not alphabetical: these read as the order a schedule runs in.
              options={entryNames}
              sorted={false}
              disabled={busy || loading}
              placeholder={`Select a ${singular.toLowerCase()}`}
              // No empty option offered: something has to answer this one, and the way to change it
              // is to name the entry that takes over rather than to clear it and leave nothing.
              menuZIndexClassName={layers.menuOverPanel}
            />
            : <MultiSelectField
              label={behaviour.question}
              values={answerTo(behaviour)}
              onChange={(values) => void answerQuestion(behaviour, values)}
              options={entryNames}
              disabled={busy || loading}
              placeholder="None"
            />}
          <p className="mt-1 text-xs text-slate-500">{behaviour.hint}</p>
        </div>)}
      </div>
    </div>}

    <div className="rounded-lg border border-slate-200 bg-white">
      {/* The name of the list, what is in it, and the box that narrows it - one bar, the same
          arrangement Branches uses in the section beside this one. It stacks below `sm` so none of
          the three crowds the others at 360px, and the search keeps the full width there rather
          than being squeezed against a count. */}
      <div className="flex flex-col gap-2 border-b border-slate-200 px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <span className="text-sm font-medium text-slate-700">{label}</span>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <div className="relative min-w-0 sm:w-56">
            <SearchRoundedIcon aria-hidden="true" style={{ fontSize: 18 }} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              aria-label={`Search ${label.toLowerCase()}`}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search ${label.toLowerCase()}...`}
              className="h-9 w-full rounded-md border border-slate-300 bg-white pl-8 pr-2 text-sm text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>
          {/* While searching the count is what is on screen out of what there is, so a filtered list
              never reads as a list that has lost entries. */}
          <span className="shrink-0 text-xs text-slate-400">
            {loading ? "Loading..." : searching ? `${shown.length} of ${rows.length} shown` : `${rows.length} in the list`}
          </span>
        </div>
      </div>
      {loading ? null : rows.length === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-slate-500">Nothing in this list yet. Add the first one above.</p>
      ) : shown.length === 0 ? (
        // A search that matches nothing is not an empty list, and must not read as one - the entries
        // are still there, and the way back is to clear the box rather than to add something.
        <p className="px-3 py-6 text-center text-sm text-slate-500">Nothing here matches &ldquo;{query.trim()}&rdquo;.</p>
      ) : (
        <ul className="max-h-[22rem] divide-y divide-slate-100 overflow-y-auto">
          {shown.map((record) => <li key={record.id} className="flex items-center justify-between gap-3 px-3 py-2">
            {editing?.id === record.id ? (
              <>
                <TextField
                  // `aria-label`, not `ariaLabel`: TextField spreads what it is given straight
                  // onto the input, so the camel-cased one reaches the DOM as an unknown attribute.
                  aria-label={`Rename ${record.name}`}
                  value={editing.name}
                  onChange={(event) => setEditing((current) => ({ ...current, name: event.target.value }))}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") { event.preventDefault(); void rename(); }
                    if (event.key === "Escape") { event.preventDefault(); setEditing(null); }
                  }}
                  disabled={busy}
                  className="min-w-0 flex-1"
                />
                <span className="flex shrink-0 gap-2">
                  <Button type="button" size="sm" disabled={busy} onClick={() => setEditing(null)}>Cancel</Button>
                  <Button type="button" size="sm" variant="primary" disabled={busy || !editing.name.trim()} onClick={() => void rename()}>
                    {busy ? "Saving..." : "Save"}
                  </Button>
                </span>
              </>
            ) : (
              <>
                <span className="min-w-0 break-words text-sm text-slate-700">{record.name}</span>
                {/* The module's own row menu, rather than a bare cross: an entry can be renamed as
                    well as removed, and a rename follows the employees already recorded against it. */}
                <OptionsMenu
                  ariaLabel={`Actions for ${record.name}`}
                  menuZIndexClassName={layers.menuOverPanel}
                  items={[
                    { label: "Edit", onSelect: () => setEditing({ id: record.id, name: record.name }) },
                    { label: "Delete", tone: "danger", onSelect: () => setDeleting(record) },
                  ]}
                />
              </>
            )}
          </li>)}
        </ul>
      )}
    </div>

    {deleting && <ConfirmDialog
      title={`Remove ${deleting.name}?`}
      /*
       * What actually happens, which is not what this used to say. It claimed the employees already
       * recorded against it keep it - true of the text on their record, and quite misleading about
       * the consequence: the entry was gone from every list, so nobody could be filed under it again
       * and nobody could put it back. Removing is now refused outright while anything still uses it,
       * and the server's refusal names what does.
       */
      /*
       * A staged list has not removed anything yet, so the sentence says when it will and what
       * takes it back. The refusal is the same one either way - it is the server's, and it comes at
       * Save rather than at this button.
       */
      message={staged
        ? `It will be taken off the list here, and removed when you press Save. Cancel puts it back. This can only be removed while nothing uses it — if any record still holds this ${singular.toLowerCase()}, Save will tell you which and it will stay.`
        : `It will stop being offered on the employee form. This can only be removed while nothing uses it — if any record still holds this ${singular.toLowerCase()}, you will be told which and nothing will be removed.`}
      confirmLabel="Remove"
      busyLabel="Removing..."
      loading={busy}
      layer="dialogOverPanel"
      onCancel={() => setDeleting(null)}
      onConfirm={() => void remove(deleting)}
    />}
  </div>;
}
