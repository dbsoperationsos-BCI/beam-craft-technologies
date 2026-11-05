/**
 * How one login's own sidebar arrangement is worked out.
 *
 *     canonical registry  ×  what this person may open  ×  what they arranged
 *     ────────────────────────────────────────────────────────────────────── = the sidebar
 *
 * Three inputs, in that order of authority, and each answers exactly one question:
 *
 * - The **registry** (`@/constants/navigation.mjs`) says what exists and which module each screen
 *   belongs to. A saved layout may never redefine either. Quotations is a Sales & CRM screen; no
 *   stored preference, however it was written or edited, can make it a Project Management one.
 * - **Permissions** say what this person may open. A screen they may not is absent, exactly as it
 *   is today — a layout is not a way around a guard, and reordering is not a grant.
 * - The **saved layout** says only what order to put them in. Nothing else.
 *
 * Everything here is a pure function of those three, so the drawer and the Sidebar Layout editor
 * cannot disagree: they call the same function with the same inputs and lay out the result.
 *
 * ── What happens when the application grows ───────────────────────────────────────────────────
 *
 * A module or screen added to the registry after somebody arranged their sidebar is **appended**,
 * never merged by resetting: their existing order is preserved to the letter and the new arrival
 * takes its default position among the other new arrivals. A screen they cannot open is not added
 * at all, and appears by itself — in the right place — on the first load after the permission is
 * granted. Nothing about this needs "Reset to Default" to be pressed.
 *
 * An id that has left the registry is ignored. It is not an error: a screen was removed or renamed
 * and a stale entry in one person's preference should cost nothing.
 *
 * An id whose *permission* was lost is a different case and is deliberately **kept** in the stored
 * order while being hidden from the sidebar. Dropping it would throw away where they had put it,
 * so getting the permission back would put the screen at the bottom rather than where they left it.
 */

import { SIDEBAR_MODULES, SIDEBAR_PARENT_BY_ITEM } from "../constants/navigation.mjs";

/**
 * The preference key the layout is stored under, for this login, on the server.
 *
 * `app:` because it is one answer for the whole application rather than one screen's — the same
 * namespace `app:compactView` uses. The backend accepts this key by name and validates its shape;
 * see `backend/src/modules/user/preferences/`.
 */
export const SIDEBAR_LAYOUT_KEY = "app:sidebarLayout";

/**
 * The arrangement of somebody who has never rearranged anything: the registry's own order.
 *
 * Minus the screens marked `hidden`, for the same reason `resolveSidebarLayout` drops them - a
 * layout is a description of the menu, and one that named a screen the menu never draws would be a
 * second answer to "what is in the sidebar", disagreeing with the first.
 */
// A module whose every screen is `hidden` is off the menu altogether (Project Management and Visual
// Curation on Beam Craft), so it is no part of the default order either - as the resolver drops it.
const MENU_MODULES = SIDEBAR_MODULES.filter((group) => (group.items || []).some((item) => !item.hidden));

export const DEFAULT_SIDEBAR_LAYOUT = {
  moduleOrder: MENU_MODULES.map((group) => group.id),
  submoduleOrder: Object.fromEntries(
    SIDEBAR_MODULES.map((group) => [group.id, (group.items || []).filter((item) => !item.hidden).map((item) => item.id)])
  ),
};

const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** A stored layout, or null for anything that is not one — a corrupted value reads as "no layout". */
export function asStoredLayout(value) {
  if (!isPlainObject(value)) return null;
  const moduleOrder = Array.isArray(value.moduleOrder) ? value.moduleOrder.filter((id) => typeof id === "string") : [];
  const submoduleOrder = isPlainObject(value.submoduleOrder) ? value.submoduleOrder : {};
  const cleaned = {};
  for (const [moduleId, items] of Object.entries(submoduleOrder)) {
    if (Array.isArray(items)) cleaned[moduleId] = items.filter((id) => typeof id === "string");
  }
  return { moduleOrder, submoduleOrder: cleaned };
}

/**
 * `known` in the order `saved` puts them, followed by whatever `saved` never mentioned.
 *
 * The one ordering rule in this file, used for the modules and again inside each of them. Ids that
 * are not in `known` fall away (they have left the registry, or — inside a module — they belong to
 * a different one and were never this list's to order). Duplicates are taken once: a list naming an
 * id twice would otherwise draw one screen twice and drop another.
 *
 * What was never mentioned is appended in `known`'s own order, which is the registry's, and only if
 * `isAddable` accepts it — the caller uses that to refuse a screen this person may not open.
 */
function ordered(known, saved, isAddable) {
  const remaining = new Set(known);
  const result = [];
  for (const id of saved) {
    if (remaining.has(id)) {
      result.push(id);
      remaining.delete(id);
    }
  }
  for (const id of known) {
    if (remaining.has(id) && isAddable(id)) result.push(id);
  }
  return result;
}

const sameList = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);

/**
 * Everything the sidebar and its editor need, from the three inputs.
 *
 * @param stored  what this login has saved, straight from the preference (null if nothing).
 * @param canSee  `(item, group) => boolean` — whether this person may open one screen. The caller
 *                answers from the permission set; this file never decides access.
 * @returns
 *   `groups`   what to draw: modules in the person's order, each with the screens they may open, in
 *              their order. A module left with nothing is not drawn, so no empty headings.
 *   `layout`   the same arrangement as ids, which is what the editor edits and what gets saved.
 *   `changed`  whether normalising what was stored actually changed it — a new screen appended, a
 *              dead id dropped. Only then is it worth writing back; a login that has never
 *              arranged anything is left with no stored layout at all, so it keeps following the
 *              registry's order as that order changes.
 */
export function resolveSidebarLayout(stored, canSee = () => true) {
  const saved = asStoredLayout(stored);
  const visibleItems = new Map(
    SIDEBAR_MODULES.map((group) => [
      group.id,
      // `hidden` first, and it is not a permission: a screen the studio has taken off the menu is
      // off it for everybody, Super Admin included. `canSee` answers a different question - whether
      // this person may open it - and the two must not be confused. See `SIDEBAR_MODULES`.
      new Set((group.items || []).filter((item) => !item.hidden && canSee(item, group)).map((item) => item.id)),
    ])
  );

  const moduleIds = SIDEBAR_MODULES.map((group) => group.id);
  // A module is worth adding only if there is something inside it this person may open — which is
  // the same rule that decides whether it is drawn.
  const moduleOrder = ordered(moduleIds, saved?.moduleOrder || [], (id) => visibleItems.get(id).size > 0);

  const submoduleOrder = {};
  for (const group of SIDEBAR_MODULES) {
    const known = (group.items || []).map((item) => item.id);
    // Only ids this module actually owns are considered, whatever the stored list claims. This is
    // where an entry moved between modules — by a rewritten preference or an older bug — stops:
    // it is not one of `known`, so it is dropped rather than drawn under the wrong heading.
    const savedForModule = (saved?.submoduleOrder?.[group.id] || []).filter((id) => SIDEBAR_PARENT_BY_ITEM[id] === group.id);
    submoduleOrder[group.id] = ordered(known, savedForModule, (id) => visibleItems.get(group.id).has(id));
  }

  const layout = { moduleOrder, submoduleOrder };

  const groups = moduleOrder
    .map((moduleId) => {
      const group = SIDEBAR_MODULES.find((entry) => entry.id === moduleId);
      const items = submoduleOrder[moduleId]
        .filter((id) => visibleItems.get(moduleId).has(id))
        .map((id) => group.items.find((item) => item.id === id));
      return { ...group, items };
    })
    .filter((group) => group.items.length > 0);

  const changed = Boolean(saved) && !(
    sameList(saved.moduleOrder, moduleOrder)
    && Object.keys(submoduleOrder).length === Object.keys(saved.submoduleOrder).length
    && Object.entries(submoduleOrder).every(([id, items]) => sameList(saved.submoduleOrder[id] || [], items))
  );

  return { groups, layout, changed };
}

/**
 * One entry moved within its list, as a drag drops it.
 *
 * Kept here rather than in the editor so the reordering the editor performs is the reordering the
 * tests cover. Out-of-range indices answer with the list unchanged: a drop outside the list is a
 * drop that did nothing, not an error to handle on screen.
 */
export function moveInList(list, fromIndex, toIndex) {
  if (fromIndex === toIndex) return list;
  if (fromIndex < 0 || fromIndex >= list.length || toIndex < 0 || toIndex >= list.length) return list;
  const next = [...list];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

/**
 * Where a row lands when it is dropped on the edge of another one.
 *
 * A drop is read as "before" or "after" the row under the pointer, by which half of that row the
 * pointer is in — the same reading the data table gives a column, turned on its side. Both are the
 * *gap* between two rows, and the same gap has two names: after row 1 is before row 2. This turns
 * either name into the index the moved row ends up at once it has left its own place, which is what
 * `moveInList` wants, so the line drawn while dragging and the order the drop produces cannot
 * disagree. Dropping a row into a gap it already borders answers with its own index: nothing moves.
 */
export function dropIndex(fromIndex, targetIndex, side) {
  const gap = side === "after" ? targetIndex + 1 : targetIndex;
  return fromIndex < gap ? gap - 1 : gap;
}

/**
 * A new order for the entries a person can see, put back into the full stored list.
 *
 * The editor only ever shows what this login may open, but the stored layout also carries entries
 * they may *not* — kept on purpose, so a permission taken away and given back finds the screen
 * where they left it rather than at the bottom. Reordering what is on screen must therefore not
 * disturb what is not.
 *
 * Each hidden id keeps the position it held; the visible slots, in order, take the new arrangement.
 * `visibleOrder` is a rearrangement of the visible ids and nothing else — anything else in it is
 * ignored, since only as many are taken as there are slots to fill.
 */
export function applyVisibleOrder(fullList, visibleOrder, isVisible) {
  const next = visibleOrder.filter((id) => fullList.includes(id));
  let taken = 0;
  return fullList.map((id) => (isVisible(id) && taken < next.length ? next[taken++] : id));
}

/** Whether two layouts put everything in the same place. */
export function sameLayout(a, b) {
  const left = asStoredLayout(a);
  const right = asStoredLayout(b);
  if (!left || !right) return left === right;
  const keys = new Set([...Object.keys(left.submoduleOrder), ...Object.keys(right.submoduleOrder)]);
  return sameList(left.moduleOrder, right.moduleOrder)
    && [...keys].every((id) => sameList(left.submoduleOrder[id] || [], right.submoduleOrder[id] || []));
}

/** Whether a layout is the registry's own order — what "Reset to Default" leaves behind. */
export function isDefaultLayout(layout) {
  const resolved = asStoredLayout(layout);
  if (!resolved) return true;
  return sameList(resolved.moduleOrder, DEFAULT_SIDEBAR_LAYOUT.moduleOrder)
    && Object.entries(DEFAULT_SIDEBAR_LAYOUT.submoduleOrder).every(([id, items]) => sameList(resolved.submoduleOrder[id] || [], items));
}
