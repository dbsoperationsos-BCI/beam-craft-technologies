import assert from "node:assert/strict";
import test from "node:test";

/*
 * Whether the page should make room for a docked assistant.
 *
 * The failure this exists for: the panel is `fixed` to the right edge, so the page laid out as
 * though it were not there and the module header's own controls ended up behind it - Add Lead and
 * the ⋮ menu still on the page, still clickable in principle, completely invisible.
 *
 * Two panels can be docked at once - the module assistant from the header, and a lead's own drawer
 * from a row's right-click menu - so what is counted matters more than what is set. A boolean would
 * un-inset the page the moment either closed and put the other one back over the controls.
 *
 * `window` is stubbed because the module dispatches a DOM event; nothing here needs a real one.
 */
const listeners = new Map();
globalThis.window = {
  addEventListener: (type, handler) => listeners.set(handler, type),
  removeEventListener: (handler) => listeners.delete(handler),
  dispatchEvent: (event) => {
    for (const [handler, type] of listeners) if (type === event.type) handler(event);
    return true;
  },
};
globalThis.CustomEvent = class CustomEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail;
  }
};

const { dockNebula, isNebulaDocked, onNebulaDockChange, DOCK_WIDTH_CLASS, claimNebula, nebulaClaimCount } = await import("../src/lib/ai/nebulaPanel.js");

test("nothing is docked to begin with", () => {
  assert.equal(isNebulaDocked(), false);
});

test("a docked panel asks for room, and gives it back when it closes", () => {
  const seen = [];
  const stop = onNebulaDockChange((docked) => seen.push(docked));

  const release = dockNebula();
  assert.equal(isNebulaDocked(), true);

  release();
  assert.equal(isNebulaDocked(), false);
  assert.deepEqual(seen, [true, false], "the shell is told once each way");
  stop();
});

/*
 * The case a boolean gets wrong. Open the module assistant, open a lead drawer over it, close one -
 * the page must still be making room for the other.
 */
test("two panels: the room is kept until the last one closes", () => {
  const seen = [];
  const stop = onNebulaDockChange((docked) => seen.push(docked));

  const first = dockNebula();
  const second = dockNebula();
  first();
  assert.equal(isNebulaDocked(), true, "one panel is still docked, so the room is still needed");

  second();
  assert.equal(isNebulaDocked(), false);
  assert.deepEqual(seen, [true, false], "and the shell is not told twice about the same state");
  stop();
});

// React can run an effect cleanup more than once in development; a release that decremented twice
// would leave the page un-inset with a panel still on it.
test("releasing the same claim twice does not lose the room", () => {
  const first = dockNebula();
  const second = dockNebula();
  first();
  first();
  assert.equal(isNebulaDocked(), true, "the second panel still holds its claim");
  second();
  assert.equal(isNebulaDocked(), false);
});

// The inset has to match the panel's own width, or the page reflows into the wrong place.
test("the shell insets by the panel's own width", () => {
  assert.equal(DOCK_WIDTH_CLASS, "sm:pr-[26rem]");
});

/*
 * One assistant at a time.
 *
 * The module assistant and a lead's own panel are opened from different places and live in different
 * branches of the tree. Neither knew about the other, so opening the second left the first sitting
 * behind it - and closing the second revealed an assistant nobody had asked to reopen.
 *
 * These model the exact sequence that showed it: open the module one, open a lead one, close the
 * lead one.
 */

/** A panel: claims the slot when opened, and closes if another panel takes it. */
function panel(name, log) {
  let release = null;
  const self = {
    name,
    get open() { return release !== null; },
    open_() {
      release = claimNebula(() => {
        release = null;
        log.push(`${name} closed (another panel took the slot)`);
      });
      log.push(`${name} opened`);
    },
    close_() {
      if (!release) return;
      release();
      release = null;
      log.push(`${name} closed`);
    },
  };
  return self;
}

/*
 * The bug this is really guarding: the first version announced a claim before the claimer had
 * recorded its own token, so a panel heard its own claim as somebody else's and shut itself the
 * instant it opened. Nebula simply would not open.
 */
test("a panel that opens stays open", () => {
  const log = [];
  const only = panel("module", log);
  only.open_();
  assert.equal(only.open, true, "a panel must not close itself on its own claim");
  assert.equal(nebulaClaimCount(), 1);
  only.close_();
  assert.equal(nebulaClaimCount(), 0);
});

test("opening a lead panel closes the module one, and closing it leaves nothing behind", () => {
  const log = [];
  const modulePanel = panel("module", log);
  const leadPanel = panel("lead", log);

  modulePanel.open_();
  assert.equal(modulePanel.open, true);

  leadPanel.open_();
  assert.equal(modulePanel.open, false, "the module panel steps aside rather than sitting behind");
  assert.equal(leadPanel.open, true);

  leadPanel.close_();
  assert.equal(modulePanel.open, false, "and closing the lead panel does not reveal the other one");
  assert.equal(leadPanel.open, false);
  assert.equal(nebulaClaimCount(), 0, "nothing is left holding the slot");

  /*
   * The displaced panel closes *before* the new one finishes opening: claiming displaces
   * synchronously, so the two are never both open, not even for a frame.
   */
  assert.deepEqual(log, [
    "module opened",
    "module closed (another panel took the slot)",
    "lead opened",
    "lead closed",
  ]);
});

test("it works the other way round too", () => {
  const log = [];
  const modulePanel = panel("module", log);
  const leadPanel = panel("lead", log);

  leadPanel.open_();
  modulePanel.open_();
  assert.equal(leadPanel.open, false, "a lead panel yields to the module one just the same");
  assert.equal(modulePanel.open, true);
  modulePanel.close_();
});

// A panel that was displaced has already been removed, so its own release must not remove the panel
// that replaced it - that would leave the new one open holding nothing, and the next claim would
// not close it.
test("a displaced panel's release does not take the slot from its replacement", () => {
  const first = claimNebula(() => {});
  const second = claimNebula(() => {});
  first();
  assert.equal(nebulaClaimCount(), 1, "the replacement still holds the slot");
  second();
  assert.equal(nebulaClaimCount(), 0);
});
