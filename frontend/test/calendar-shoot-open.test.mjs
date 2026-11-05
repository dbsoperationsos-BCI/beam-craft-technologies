import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (...parts) => fs.readFileSync(path.join(process.cwd(), ...parts), "utf8");
const PAGE = read("src", "components", "sales", "MeetingsPage.js");
const DIALOG = read("src", "components", "project-management", "shoot-board", "ShootRunDialog.js");

/*
 * Every employee sees the studio's shoots on the calendar; opening one is still a permission.
 *
 * Where the cameras are going is the studio's own business - the calendar draws every shoot for
 * everybody now. Pressing a card opens the Projects board on that shoot for somebody who holds
 * Projects - its ⋮ offers the other boards - **and nothing at all** for everybody else: not a
 * refusal, not a message, just a card that is not a button. Being shown a door that will not open
 * is worse than being shown no door.
 */

test("the shoot window opens for everybody, whatever a card inside it does", () => {
  // No permission is consulted before the window itself: the details are the thing most people want.
  assert.match(PAGE, /\{shootRun && <ShootRunDialog/);
  const block = PAGE.slice(PAGE.indexOf("{shootRun && <ShootRunDialog"), PAGE.indexOf("/>}", PAGE.indexOf("{shootRun && <ShootRunDialog")));
  assert.equal(/canOpenProjects \?|canRead \?/.test(block.split("onOpen")[0]), false, "nothing gates the window");
});

test("a card in the shoot window opens Projects on that shoot, and nothing without Projects", () => {
  assert.match(PAGE, /const shootOpener = canOpenProjects\n/);
  assert.match(PAGE, /router\.push\(shootBoardHref\(projectsBoard, eventId, \{ shootId \}\)\)/);
  assert.equal(/ProductionShootPanel|canOpenProduction/.test(PAGE), false);
  assert.match(PAGE, /onOpen=\{shootOpener\.onOpen\}/);
  assert.match(PAGE, /canOpen=\{shootOpener\.canOpen\}/);
});

test("the dialog asks the caller whether a card can be opened, instead of assuming", () => {
  /*
   * It hard-coded `shoot.productionShootId`, which is the right question only for the Production
   * panel: a viewer holding Projects alone would have had a dead card on a shoot whose production
   * is not raised, though the board behind it would have opened perfectly well.
   */
  assert.match(DIALOG, /canOpen = \(shoot\) => Boolean\(shoot\.productionShootId\)/);
  assert.match(DIALOG, /onOpen=\{onOpen && canOpen\(shoot\) \? onOpen : undefined\}/);
  // The Shoot Board passes none and keeps the rule it always had.
  const board = read("src", "components", "project-management", "shoot-board", "ShootBoardPage.js");
  assert.equal(/canOpen=/.test(board), false);
});

test("nothing is said to somebody who may open none of the boards", () => {
  // No toast, no notice, no disabled-looking control: `onOpen` is simply absent.
  assert.match(PAGE, /onOpen: undefined/);
  assert.equal(/do not have permission|no permission to open/i.test(PAGE), false);
});

test("the shoot the window is built from carries what the panel opens on", async () => {
  /*
   * `shootRunOf` turns calendar entries into the shape the Shoot Board's cards read. It never
   * carried `productionShootId`, because nothing on the calendar opened the Production panel - so
   * the card would have been dead for the very people who hold Production.
   */
  const { shootRunOf } = await import("../src/lib/schedule.js");
  const { run } = shootRunOf([{
    id: "shoot:7", kind: "shoot", title: "Reception", reference: "SH-7", subject: "EV-1",
    day: "2026-10-30", location: "Erode", productionShootId: 42, meta: {},
  }]);
  assert.equal(run.shoots[0].productionShootId, 42);
  // Null where production has not been raised: there is nothing to open, and the card says so by
  // not being a button.
  const { run: none } = shootRunOf([{ id: "shoot:8", kind: "shoot", title: "Candid", day: "2026-10-30", meta: {} }]);
  assert.equal(none.shoots[0].productionShootId, null);
});
