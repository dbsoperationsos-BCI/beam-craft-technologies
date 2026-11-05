const test = require("node:test");
const assert = require("node:assert/strict");

process.env.JWT_SECRET = process.env.JWT_SECRET || "signature-album-test-secret";

/*
 * The client's album API is public, so the lookup, the PIN and the reading are rate limited per
 * address. The photos are not - a reader scrolling a large album asks for each one.
 */
test("the public album routes are rate limited, and the photo routes are left to the session", () => {
  const router = require("../src/modules/image-selection/signature-album/signatureAlbum.public.routes");
  const stack = (method, path) => router.stack.find((layer) => layer.route?.path === path && layer.route.methods[method]).route.stack.map((layer) => layer.handle.name);
  for (const [method, path] of [["get", "/:token"], ["post", "/:token/verify"], ["get", "/:token/content"], ["get", "/:token/chapters/:chapterId/items"]]) {
    assert.equal(stack(method, path)[0], "rateLimit", `${method.toUpperCase()} ${path} is limited`);
  }
  assert.deepEqual(stack("get", "/:token/images/:imageId/thumbnail").filter((name) => name === "rateLimit"), []);
});

test("the PIN's attempt counter is keyed on the client's own address, not the proxy's", async () => {
  const controllerPath = require.resolve("../src/modules/image-selection/signature-album/signatureAlbum.public.controller");
  const clientServicePath = require.resolve("../src/modules/image-selection/signature-album/signatureAlbum.client.service");
  const clientService = require(clientServicePath);
  const original = clientService.createSignatureAlbumClientService;
  const seen = [];
  clientService.createSignatureAlbumClientService = () => ({ verifyPin: async (code, pin, address) => { seen.push(address); return { sessionToken: "s" }; } });
  delete require.cache[controllerPath];
  const previous = { header: process.env.TRUST_PROXY_HEADER, hops: process.env.TRUST_PROXY_HOPS };
  process.env.TRUST_PROXY_HEADER = "true";
  delete process.env.TRUST_PROXY_HOPS;
  try {
    const controller = require(controllerPath);
    const res = { status() { return this; }, json(body) { this.body = body; return this; } };
    await controller.verify({ params: { token: "ABC234" }, body: { pin: "1234" }, ip: "127.0.0.1", headers: { "x-forwarded-for": "203.0.113.9" } }, res);
    assert.deepEqual(seen, ["203.0.113.9"]);
  } finally {
    clientService.createSignatureAlbumClientService = original;
    delete require.cache[controllerPath];
    if (previous.header === undefined) delete process.env.TRUST_PROXY_HEADER; else process.env.TRUST_PROXY_HEADER = previous.header;
    if (previous.hops !== undefined) process.env.TRUST_PROXY_HOPS = previous.hops;
  }
});
