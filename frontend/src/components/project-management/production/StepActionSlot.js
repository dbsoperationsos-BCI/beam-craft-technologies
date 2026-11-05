"use client";

import { createContext, useContext } from "react";
import { createPortal } from "react-dom";

/*
 * A step's own action, drawn in the shoot panel's footer - beside Close, where the Plan's Submit
 * plan sits - so Execution and Plan put their button in the same place and the same style. The
 * panel owns the footer and provides the spot (`StepActionSlotProvider`); the step form, which owns
 * the action, renders it there (`StepAction`). Outside a provider it is drawn where it stands.
 */
const SlotContext = createContext(null);

export function StepActionSlotProvider({ node, children }) {
  return <SlotContext.Provider value={node}>{children}</SlotContext.Provider>;
}

export function StepAction({ children }) {
  const node = useContext(SlotContext);
  return node ? createPortal(children, node) : children;
}

/*
 * The step list, drawn in the shoot panel's left column from lg up - its own pane, as the Plan's
 * section list is - in the same way: the panel provides the column, Execution renders its list there.
 * Outside a provider nothing is drawn; the step's own row of numbered circles still is.
 */
const ListContext = createContext(null);

export function StepListSlotProvider({ node, children }) {
  return <ListContext.Provider value={node}>{children}</ListContext.Provider>;
}

export function StepList({ children }) {
  const node = useContext(ListContext);
  return node ? createPortal(children, node) : null;
}
