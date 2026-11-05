const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SERVER = fs.readFileSync(path.join(__dirname, "..", "src", "server.js"), "utf8");

/*
 * `salesProjectRoutes` and `salesProjectAttachmentRoutes` are mounted on the bare `/api/sales`
 * prefix, and each guards *everything* that reaches it - as router-level middleware, before route
 * matching - not only the paths it actually serves. Express tries mounted routers in the order
 * they were registered, so any other `/api/sales/...` router mounted *after* these two has its
 * requests intercepted and wrongly refused by whichever of the two reaches them first, regardless
 * of what permission that router's own routes actually need.
 *
 * This has already broken once - the Callyzer webhook, unauthenticated by design, answered 401 to
 * Callyzer until it was moved ahead - and broke again for `/api/sales/whatsapp-chat/my-session`,
 * deliberately built to answer for anybody signed in, which the attachments router's blanket
 * `SALES / CRM Leads` guard was silently overruling for anyone without that permission. Every
 * `/api/sales/...` router must be mounted before the two bare ones, and this pins that so it
 * cannot regress unnoticed a third time.
 */
test("every other /api/sales/... router is mounted ahead of the two bare /api/sales routers", () => {
  const bareMountAt = SERVER.indexOf('app.use("/api/sales", salesProjectRoutes)');
  assert.ok(bareMountAt > -1, "salesProjectRoutes must still be mounted on the bare /api/sales prefix");

  const prefixedMounts = [...SERVER.matchAll(/app\.use\("(\/api\/sales\/[^"]+)"/g)];
  assert.ok(prefixedMounts.length >= 10, "expected at least the routers known to share this prefix");

  for (const match of prefixedMounts) {
    assert.ok(
      match.index < bareMountAt,
      `${match[1]} is mounted after the bare /api/sales routers and would have its requests intercepted by them`,
    );
  }
});

test("the two bare /api/sales routers are still mounted next to each other", () => {
  const projectAt = SERVER.indexOf('app.use("/api/sales", salesProjectRoutes)');
  const attachmentsAt = SERVER.indexOf('app.use("/api/sales", salesProjectAttachmentRoutes)');
  assert.ok(projectAt > -1 && attachmentsAt > -1);
  assert.ok(projectAt < attachmentsAt);
});
