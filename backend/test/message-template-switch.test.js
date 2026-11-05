const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { isMessageEnabled } = require("../src/services/messageTemplate");

/*
 * **Each message on Settings → Templates can be switched off, one at a time.**
 *
 * Whether a message was sent did not live anywhere a studio could reach per message: the shoot crew
 * notice's switch covers its two wordings together, and a project's step messages had none at all -
 * so a studio wanting "shoot completed" and not "started from studio" could have both or neither.
 */

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

test("a message nobody has written is still on", async () => {
  /*
   * The important one. A sender with its own built-in wording goes on sending it, so asking
   * `getTemplate` instead would read a switched-off message as an unwritten one - and send the very
   * message somebody just switched off. Only an explicit `enabled = false` stops it.
   */
  const client = (row) => ({ messageTemplate: { findUnique: async () => row } });
  assert.equal(await isMessageEnabled("ANY", client(null)), true, "never written - its sender's default still goes");
  assert.equal(await isMessageEnabled("ANY", client({ enabled: true })), true);
  assert.equal(await isMessageEnabled("ANY", client({ enabled: false })), false);
  // A read that fails must not silently stop the studio's messages.
  assert.equal(await isMessageEnabled("ANY", { messageTemplate: { findUnique: async () => { throw new Error("db down"); } } }), true);
});

test("the switch is its own endpoint, so a message with no wording can be switched off", () => {
  const controller = read("src/modules/settings/message-templates/controller.js");
  assert.match(controller, /async function setTemplateEnabled\(req, res\)/);
  // The ones sending a built-in default are exactly the ones somebody wants stopped, and demanding a
  // valid wording first would refuse to turn those off.
  assert.match(controller, /create: \{ key, name: key, body: "", enabled: parsed\.data\.enabled/);
  assert.match(read("src/modules/settings/message-templates/routes.js"), /router\.put\("\/:key\/enabled", maySettings, setTemplateEnabled\);/);
  // Saving a wording leaves the switch alone: two answers from one screen, neither carrying the other.
  assert.match(controller, /\.\.\.\(parsed\.data\.enabled === undefined \? \{\} : \{ enabled: parsed\.data\.enabled \}\)/);
});

test("every automatic sender asks before it sends", () => {
  // A sender that does not is a message the studio cannot switch off.
  assert.match(read("src/modules/project-management/production/messages.js"), /if \(!\(await isMessageEnabled\(TEMPLATE_FOR\[messageStep\], client\)\)\) return/);
  assert.match(read("src/modules/settings/shoot-crew-notice/sender.js"), /if \(!sending\[item\.kind\]\) continue;/);
  assert.match(read("src/modules/settings/shoot-crew-notice/vendorSender.js"), /if \(!sending\[item\.kind\]\) continue;/);
});

test("a message skipped while off is still owed when it is switched on", () => {
  /*
   * The row is left exactly as it was - not marked as sent. Switching a wording back on should send
   * what was owed while it was off rather than having quietly spent it, and it is not trouble either,
   * because nothing is wrong.
   */
  for (const arm of ["sender.js", "vendorSender.js"]) {
    const source = read(`src/modules/settings/shoot-crew-notice/${arm}`);
    const at = source.indexOf("if (!sending[item.kind]) continue;");
    assert.ok(at > 0, arm);
    // Skipped before anything is written or claimed - the **call**, not `remember`'s own definition,
    // which sits above the sweep.
    assert.ok(at < source.indexOf("await remember(item"), `${arm}: skipped before the row is claimed`);
  }
});

test("a switched-off step is not recorded as a failure", () => {
  const source = read("src/modules/project-management/production/messages.js");
  // No FAILED row, so no "Not sent · Retry" beside a step the studio turned off - the app would be
  // arguing with the answer.
  assert.match(source, /return \{ step: messageStep, status: "OFF", reason: null, sentAt: null \};/);
  assert.match(source, /would be the app arguing with the answer/);
});

test("the step messages come from the project's Pre-Production Coordinator", () => {
  const source = read("src/modules/project-management/production/messages.js");
  assert.match(source, /projectSender\.resolve\(project, projectSender\.ROLES\.PRE_PRODUCTION_COORDINATOR/);
  /*
   * It used to be whoever linked the group, which made the sender an accident of who pressed Link and
   * stopped a project's messages dead when that person left. The group constraint is said out loud:
   * WhatsApp only accepts a group message from a participant, and the linker was one by definition.
   */
  assert.match(source, /A group only accepts a message from somebody in it/);
  assert.match(source, /This message goes from the Pre-Production Coordinator\./);
  assert.doesNotMatch(source, /senderId = project\.whatsappGroupLinkedByUserId/);
});

test("the column defaults to on, so nothing changes until a switch is turned off", () => {
  const migration = read("prisma/migrations/20261104130000_message_template_enabled/migration.sql");
  assert.match(migration, /ALTER TABLE `message_template` ADD COLUMN `enabled` BOOLEAN NOT NULL DEFAULT true;/);
  assert.doesNotMatch(migration, /UPDATE `message_template`/);
});
