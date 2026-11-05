const test = require("node:test");
const assert = require("node:assert/strict");
const whatsapp = require("../src/modules/client/requests/whatsapp");

// No database and no WhatsApp: a stand-in queue records what would have been queued.
const fakeActivity = () => { const queued = []; return { queued, queue: async (row) => { queued.push(row); return { created: true }; } }; };
const fakeClient = {
  salesProject: { findUnique: async () => ({ id: "p1", eventId: "DBS-BK-T-1", whatsappGroupName: "WED Test", clientMainNumber: "9876543210", crmEmployeeId: null, projectManagerEmployeeId: "e1" }) },
  user: { findMany: async () => [{ name: "Owner", linkedEmployee: { employeeName: "Owner", contactNumber: "9000000001" } }] },
  employee: { findUnique: async () => ({ employeeName: "Manager", contactNumber: "9000000002" }) },
};
const rows = [{ id: 1, projectId: "p1", itemName: "Drone", quantity: 1 }, { id: 2, projectId: "p1", itemName: "Reels", quantity: 2 }];
const shoot = { id: "s1", shoot: "Haldi" };

test("switched off (the default), nothing is queued or sent", async () => {
  delete process.env.CLIENT_REQUEST_WHATSAPP;
  const activity = fakeActivity();
  assert.equal(await whatsapp.afterRequest({ rows, shoot, client: fakeClient, activity }), "off");
  assert.equal(activity.queued.length, 0);
  assert.deepEqual(await whatsapp.runOnce({ activity }), { sent: 0, failed: 0, skipped: "off" });
});

test("switched on, the owners, the project manager and the client are each queued one message", async () => {
  process.env.CLIENT_REQUEST_WHATSAPP = "on";
  try {
    const activity = fakeActivity();
    assert.equal(await whatsapp.afterRequest({ rows, shoot, client: fakeClient, activity }), "queued");
    assert.deepEqual(activity.queued.map((row) => [row.trigger, row.recipient.address]), [
      ["CLIENT_REQUEST_TEAM", "919000000001"],
      ["CLIENT_REQUEST_TEAM", "919000000002"],
      ["CLIENT_REQUEST_CLIENT", "919876543210"],
    ]);
    assert.match(activity.queued[0].body, /Booking: DBS-BK-T-1[\s\S]*Shoot: Haldi[\s\S]*- Reels x2/);
    assert.match(activity.queued[2].body, /received your request for Haldi[\s\S]*contact you soon/);
  } finally {
    delete process.env.CLIENT_REQUEST_WHATSAPP;
  }
});
