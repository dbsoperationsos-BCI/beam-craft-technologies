const test = require("node:test");
const assert = require("node:assert/strict");

/*
 * What the session endpoint tells the browser about the two switches.
 *
 * There are two, and they are not the same question: the studio-wide switch that turns CRM WhatsApp
 * off for everybody, and one CRM's own, which a Super Admin moves in Settings → User Settings →
 * WhatsApp. Both were checked on every write here. Only the first was ever *reported*, so the
 * browser could not tell somebody who has not linked their WhatsApp from somebody who is not
 * allowed to - and Leads & Followups' "your WhatsApp is not linked" reminder is exactly the screen
 * that must know the difference, since nagging a blocked CRM to do something the server would
 * refuse is worse than saying nothing.
 *
 * The repository is stubbed rather than reached, so this is about what the handler reports and not
 * about what the database holds.
 */

const repositoryPath = require.resolve("../src/modules/sales/whatsapp-chat/repository");
const realRepository = require(repositoryPath);

let studioSwitch = true;
let userSwitch = true;
const seenUserIds = [];

// Swapped in before the controller is loaded, so the controller closes over these instead.
require.cache[repositoryPath].exports = {
  ...realRepository,
  isChatEnabled: async () => studioSwitch,
  isChatEnabledForUser: async (userId) => { seenUserIds.push(userId); return userSwitch; },
};

const { status } = require("../src/modules/sales/whatsapp-chat/controller");

/** The handler, called the way the router calls it, answering with whatever it passed to `json`. */
async function readSession(userId = 4242) {
  let payload;
  let code = 200;
  const res = {
    json: (body) => { payload = body; return res; },
    status: (value) => { code = value; return res; },
  };
  await status({ user: { id: userId } }, res);
  assert.equal(code, 200, `the session read failed: ${JSON.stringify(payload)}`);
  return payload?.data;
}

test("the reply carries both switches", async () => {
  studioSwitch = true;
  userSwitch = true;
  const data = await readSession();
  assert.equal(data.chatEnabled, true, "the studio switch is not reported");
  assert.equal(data.userChatEnabled, true, "this CRM's own switch is not reported");
});

test("this CRM's own switch is reported off even while the studio's is on", async () => {
  // The case the reminder exists to respect: WhatsApp is available, this person may not use it.
  studioSwitch = true;
  userSwitch = false;
  const data = await readSession();
  assert.equal(data.chatEnabled, true);
  assert.equal(data.userChatEnabled, false);
});

test("the studio switch is reported off independently of this CRM's", async () => {
  studioSwitch = false;
  userSwitch = true;
  const data = await readSession();
  assert.equal(data.chatEnabled, false);
  assert.equal(data.userChatEnabled, true);
});

test("the switch asked about is the signed-in user's own", async () => {
  // Never an id off the URL or the body: one CRM's WhatsApp is not another's, and this endpoint
  // reports only the session it belongs to.
  studioSwitch = true;
  userSwitch = true;
  seenUserIds.length = 0;
  await readSession(97531);
  assert.deepEqual(seenUserIds, [97531]);
});

test("the session's own state is still reported beside them", async () => {
  // The switches were added to this reply, not substituted for what it already said.
  studioSwitch = true;
  userSwitch = true;
  const data = await readSession();
  for (const field of ["status", "qr", "phone", "error"]) {
    assert.ok(field in data, `${field} is no longer reported`);
  }
});
