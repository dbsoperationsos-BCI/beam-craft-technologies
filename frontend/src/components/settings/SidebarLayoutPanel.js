"use client";

import { useEffect, useState } from "react";
import Button from "@/components/shared/Button";
import SortableList from "@/components/shared/SortableList";
import useSidebarLayout from "@/components/preferences/useSidebarLayout";
import { applyVisibleOrder, sameLayout } from "@/lib/sidebarLayout.mjs";

/**
 * Settings → User Preference → Sidebar Layout: the order this login reads its own navigation in.
 *
 * The list here **is** the sidebar. Both are drawn from `useSidebarLayout`, which merges the one
 * canonical registry with this person's permissions and their saved order, so what is arranged here
 * is exactly what the drawer shows — there is no second copy of the navigation to keep in step, and
 * a module missing from this list is missing because the role cannot open it.
 *
 * Modules only, and the whole row is the handle. The screens inside a module are not arranged here:
 * they keep the order the application gives them, and any arrangement of them saved before this
 * editor stopped offering them is carried through untouched rather than discarded — the draft is
 * built from the stored layout, so `submoduleOrder` survives every save made from this panel. The
 * rows carry no icon either; the module's name is what is being put in an order, and a column of
 * glyphs beside it only competed with the sidebar's own.
 *
 * Rearranging is a draft until it is saved. Dragging moves the row here and nothing else — the
 * sidebar itself does not change under somebody who is still deciding, and a layout is not written
 * to the account on the way past every position a module was dragged through. **Save changes**
 * commits it, and is offered only while there is something to commit; **Reset to Default** forgets
 * the arrangement entirely and goes back to the application's own order.
 *
 * Leaving the section with a draft unsaved asks first, through the same rail confirmation the form
 * builder and Project Settings use — `unsavedRef` is how the rail knows.
 */

export default function SidebarLayoutPanel({ unsavedRef }) {
  const { groups, layout, loading, save, reset, customised } = useSidebarLayout();

  /*
   * The arrangement being worked on, or null while it is simply what was saved.
   *
   * Null rather than a copy of the layout, so that anything arriving from outside while nobody is
   * dragging — a module appended because a permission was granted, an arrangement saved on another
   * device — is shown straight away. Once there is a draft it stands until it is saved or reset:
   * replacing it would throw away edits somebody is in the middle of making.
   */
  const [draft, setDraft] = useState(null);
  const shown = draft || layout;
  const dirty = Boolean(draft) && !sameLayout(draft, layout);

  // What the rail reads before letting a click take this section off screen.
  useEffect(() => {
    if (!unsavedRef) return undefined;
    unsavedRef.current = dirty;
    // Left clean on the way out, so a section returned to later does not still claim to be dirty.
    return () => { unsavedRef.current = false; };
  }, [unsavedRef, dirty]);

  // What is on screen, which is what may be rearranged. The stored layout can hold more — a module
  // whose permissions were taken away keeps its place there, and `applyVisibleOrder` keeps it.
  const visibleModules = new Set(groups.map((group) => group.id));

  const reorderModules = (moduleIds) => setDraft({
    ...shown,
    moduleOrder: applyVisibleOrder(shown.moduleOrder, moduleIds, (id) => visibleModules.has(id)),
  });

  /** The draft, committed. It stands down once saved: what is stored is now what is on screen. */
  const saveDraft = () => {
    if (!dirty) return;
    save(draft);
    setDraft(null);
  };

  /** Back to the application's own order, and the account stops holding an arrangement at all. */
  const resetToDefault = () => {
    setDraft(null);
    reset();
  };

  if (loading) return <p className="px-1 py-6 text-center text-sm text-slate-500">Loading your sidebar layout...</p>;
  if (!groups.length) {
    return <p className="px-1 py-6 text-center text-sm text-slate-500">There are no modules on your sidebar to arrange yet.</p>;
  }

  /*
   * What is drawn: the modules this person may open, in the order being worked on.
   *
   * `groups` is the sidebar as it is saved; the draft only ever reorders it, so the rows are those
   * same groups read in the draft's order. Anything the draft names that is not on screen — a module
   * whose permissions have gone — falls away here exactly as it does in the drawer.
   */
  const moduleRows = shown.moduleOrder
    .map((moduleId) => groups.find((group) => group.id === moduleId))
    .filter(Boolean)
    .map((group) => ({ id: group.id, label: group.title }));

  const renderModuleRow = (item) => <span className="block truncate text-sm font-medium text-slate-800">{item.label}</span>;

  return <div className="max-w-3xl space-y-4">
    <p className="text-xs text-slate-500 sm:text-sm">
      Drag a module — anywhere on its row — to move it up or down your sidebar. Nothing changes until
      you press Save changes; once saved, your arrangement is kept on your account, so it follows you
      to any device you sign in on.
    </p>

    <SortableList
      label="Sidebar modules"
      items={moduleRows}
      onReorder={reorderModules}
      renderRow={renderModuleRow}
    />

    <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4">
      {/* Both offered only when they would do something: nothing to put back for somebody who has
          never arranged anything, and nothing to save until something has been moved. */}
      <Button type="button" variant="ghost" disabled={!customised && !dirty} onClick={resetToDefault}>Reset to Default</Button>
      <Button type="button" variant="primary" disabled={!dirty} onClick={saveDraft}>Save changes</Button>
    </div>
  </div>;
}
