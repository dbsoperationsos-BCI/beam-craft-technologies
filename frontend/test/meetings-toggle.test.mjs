import test from "node:test";
import assert from "node:assert/strict";

import { meetingsToggle } from "../src/lib/meetingsToggle.js";

/*
 * The meetings icon is a toggle whose two states are two pages.
 *
 * It only ever pushed before, so pressing a control that looked pressed did nothing at all - the
 * one thing a toggle must not do. Closing has to put somebody back where they were, which is not
 * the same as going back: after a few clicks inside the meetings screen, the last navigation is not
 * the page it was opened from.
 */

const MEETINGS = "/sales/meetings";
const FALLBACK = "/sales/crm";
const toggle = (state) => meetingsToggle({ meetings: MEETINGS, fallback: FALLBACK, ...state });

test("opening goes to meetings and remembers the screen being left", () => {
  const next = toggle({ open: false, pathname: "/image-selection/projects", returnTo: null });
  assert.equal(next.href, MEETINGS);
  assert.equal(next.returnTo, "/image-selection/projects", "so closing can come back to it");
});

test("closing goes back to that screen, and forgets it", () => {
  const next = toggle({ open: true, pathname: MEETINGS, returnTo: "/image-selection/projects" });
  assert.equal(next.href, "/image-selection/projects");
  assert.equal(next.returnTo, null, "the next open records where it is opened from then");
});

/*
 * Somebody who opened the meetings screen from a link, or refreshed on it, has nowhere to go back
 * to. Closing still has to do something, so it goes where the application sends anybody with
 * nowhere to be.
 */
test("closing with nothing to go back to falls to the first screen the role may open", () => {
  const next = toggle({ open: true, pathname: MEETINGS, returnTo: null });
  assert.equal(next.href, FALLBACK);
  assert.equal(next.returnTo, null);
});

/*
 * The edge that would bring the dead toggle straight back: a remembered path pointing at the
 * meetings screen itself. Closing would navigate to where it already is, the control would stay
 * looking pressed, and pressing it again would do nothing.
 */
test("a remembered path pointing at meetings is ignored rather than looped on", () => {
  const next = toggle({ open: true, pathname: MEETINGS, returnTo: MEETINGS });
  assert.equal(next.href, FALLBACK, "closing must always leave the meetings screen");
});

test("opening twice from different screens remembers the later one", () => {
  const first = toggle({ open: false, pathname: "/accounts/manager", returnTo: null });
  const closed = toggle({ open: true, pathname: MEETINGS, returnTo: first.returnTo });
  assert.equal(closed.href, "/accounts/manager");
  const second = toggle({ open: false, pathname: "/employees", returnTo: closed.returnTo });
  assert.equal(second.returnTo, "/employees");
});
