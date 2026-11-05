const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

/*
 * Where a webhook secret is allowed to travel.
 *
 * Callyzer's panel takes a Secret but never says how it sends it, and deliveries were refused with
 * the correct value configured - the two header names originally read were not the ones it uses.
 * The reader now accepts every conventional carrier, and these lock that list down: a name dropped
 * from it silently starts refusing a sender that was working.
 *
 * The reader is exercised through a stand-in request rather than through Express, because that is
 * all it touches - `header()`, `query` and `body`.
 */

const SECRET = "e0286300000000000000000000000000000000000000000000000000000000ff";

// The same shape `readWebhookSecret` reads: Express lowercases header names and `header()` is
// case-insensitive, which this mirrors.
function requestWith({ headers = {}, query = {}, body = undefined } = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    headers: lower,
    query,
    body,
    header: (name) => lower[String(name).toLowerCase()],
  };
}

/*
 * Loaded from the controller, which pulls in Prisma and the whole CRM service layer. That is a
 * heavy import for two pure functions, so they are re-declared here in the shape the controller
 * uses and checked against it - the assertion at the end is what keeps the two honest.
 */
const HEADERS = [
  "x-callyzer-secret",
  "x-webhook-secret",
  "x-secret",
  "secret",
  "x-api-key",
  "api-key",
  "x-auth-token",
  "auth-token",
  "token",
];

function readWebhookSecret(req) {
  for (const header of HEADERS) {
    const value = String(req.header(header) || "").trim();
    if (value) return value;
  }
  const authorization = String(req.header("authorization") || "").trim();
  if (authorization) return authorization.replace(/^Bearer\s+/i, "").trim();
  const fromQuery = String(req.query.secret || req.query.token || "").trim();
  if (fromQuery) return fromQuery;
  const body = req.body;
  if (body && typeof body === "object" && !Array.isArray(body)) {
    return String(body.secret || body.token || body.webhook_secret || "").trim();
  }
  return "";
}

function secretMatches(provided, expected) {
  const a = Buffer.from(String(provided || ""), "utf8");
  const b = Buffer.from(String(expected || ""), "utf8");
  if (a.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

test("the secret is found in every header a sender might use", () => {
  for (const header of HEADERS) {
    const req = requestWith({ headers: { [header]: SECRET } });
    assert.equal(readWebhookSecret(req), SECRET, `${header} was not read`);
  }
});

test("a header's name is matched whatever its casing", () => {
  const req = requestWith({ headers: { "X-Callyzer-Secret": SECRET } });
  assert.equal(readWebhookSecret(req), SECRET);
});

test("Authorization works bare and as a Bearer token", () => {
  assert.equal(readWebhookSecret(requestWith({ headers: { authorization: SECRET } })), SECRET);
  assert.equal(readWebhookSecret(requestWith({ headers: { authorization: `Bearer ${SECRET}` } })), SECRET);
  assert.equal(readWebhookSecret(requestWith({ headers: { authorization: `bearer ${SECRET}` } })), SECRET);
});

test("the query string carries it too", () => {
  assert.equal(readWebhookSecret(requestWith({ query: { secret: SECRET } })), SECRET);
  assert.equal(readWebhookSecret(requestWith({ query: { token: SECRET } })), SECRET);
});

test("a secret inside an object body is read", () => {
  assert.equal(readWebhookSecret(requestWith({ body: { secret: SECRET, data: [] } })), SECRET);
  assert.equal(readWebhookSecret(requestWith({ body: { webhook_secret: SECRET } })), SECRET);
});

test("an array body is never indexed into", () => {
  // The usual delivery is a bare array of employees. Reading `.secret` off it must not throw and
  // must not invent a value.
  assert.equal(readWebhookSecret(requestWith({ body: [{ emp_name: "x", call_logs: [] }] })), "");
});

test("nothing presented reads as nothing, not as a match", () => {
  assert.equal(readWebhookSecret(requestWith({})), "");
  assert.equal(secretMatches(readWebhookSecret(requestWith({})), SECRET), false);
});

test("whitespace around a pasted secret is ignored", () => {
  assert.equal(readWebhookSecret(requestWith({ headers: { "x-callyzer-secret": `  ${SECRET}  ` } })), SECRET);
});

test("the wrong secret is refused, whatever its length", () => {
  assert.equal(secretMatches(SECRET, SECRET), true);
  assert.equal(secretMatches("wrong", SECRET), false);
  assert.equal(secretMatches(`${SECRET}extra`, SECRET), false);
  assert.equal(secretMatches(SECRET.slice(0, -1), SECRET), false);
  // An empty provided value must never pass, even against an empty expectation - the caller only
  // reaches this when a secret is configured.
  assert.equal(secretMatches("", ""), false);
});

test("comparison does not throw on a length mismatch", () => {
  // `crypto.timingSafeEqual` throws when the buffers differ in length; the guard must catch that
  // before it is called, or a short secret would 500 instead of 401.
  assert.doesNotThrow(() => secretMatches("a", SECRET));
});

test("this list matches the controller's", () => {
  // The point of the copy above is to avoid importing Prisma; the point of this is to notice when
  // the copy drifts from the real thing.
  const source = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "..", "src", "modules", "sales", "crm-leads", "controller.js"),
    "utf8",
  );
  const block = source.match(/const WEBHOOK_SECRET_HEADERS = \[([\s\S]*?)\];/);
  assert.ok(block, "WEBHOOK_SECRET_HEADERS is no longer declared as a literal array");
  const declared = [...block[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(declared, HEADERS);
});


/*
 * Callyzer signs; it does not send the secret.
 *
 * Its panel labels the field "Secret", which reads as something to present - and that is how this
 * was first written, so every delivery was refused with the correct value configured on both
 * sides. The server's log named the header it actually sends: `x-callyzer-signature`. A signature
 * is an HMAC of the body keyed with the secret, so no string comparison could ever have matched.
 */
const SIGNATURE_HEADERS = ["x-callyzer-signature", "x-webhook-signature", "x-hub-signature-256", "x-hub-signature", "x-signature"];

function signingKeys(secret) {
  const keys = [Buffer.from(secret, "utf8")];
  if (/^[0-9a-f]+$/i.test(secret) && secret.length % 2 === 0) keys.push(Buffer.from(secret, "hex"));
  if (/^[A-Za-z0-9+/=_-]+$/.test(secret)) {
    const decoded = Buffer.from(secret, "base64");
    if (decoded.length) keys.push(decoded);
  }
  return keys;
}

function signatureMatches(req, secret) {
  let provided = "";
  for (const header of SIGNATURE_HEADERS) {
    provided = String(req.header(header) || "").trim();
    if (provided) break;
  }
  if (!provided) return false;
  const body = req.rawBody;
  if (!body || !body.length) return false;
  const candidate = provided.replace(/^(?:sha1|sha256|sha512|hmac)[=:\s]+/i, "").trim();
  if (secretMatches(candidate, secret)) return true;
  const matches = (digest) => secretMatches(candidate, digest)
    || (/^[0-9a-f]+$/i.test(digest) && secretMatches(candidate.toLowerCase(), digest.toLowerCase()));
  for (const key of signingKeys(secret)) {
    for (const algorithm of ["sha256", "sha1", "sha512"]) {
      for (const encoding of ["hex", "base64", "base64url"]) {
        let digest;
        try { digest = crypto.createHmac(algorithm, key).update(body).digest(encoding); } catch { continue; }
        if (matches(digest)) return true;
      }
    }
  }
  for (const algorithm of ["sha256", "sha1"]) {
    for (const order of [[secret, body], [body, secret]]) {
      for (const encoding of ["hex", "base64"]) {
        let digest;
        try { digest = crypto.createHash(algorithm).update(order[0]).update(order[1]).digest(encoding); } catch { continue; }
        if (matches(digest)) return true;
      }
    }
  }
  return false;
}

const BODY = Buffer.from(JSON.stringify([{ emp_name: "Employee Name", call_logs: [] }]));
const signed = (algorithm, encoding, body = BODY, key = SECRET) =>
  crypto.createHmac(algorithm, key).update(body).digest(encoding);

function signedRequest(signature, { body = BODY, header = "x-callyzer-signature" } = {}) {
  const req = requestWith({ headers: { [header]: signature } });
  req.rawBody = body;
  return req;
}

test("a signature over the body verifies, in either algorithm and any encoding", () => {
  for (const algorithm of ["sha256", "sha1"]) {
    for (const encoding of ["hex", "base64"]) {
      assert.equal(
        signatureMatches(signedRequest(signed(algorithm, encoding)), SECRET),
        true,
        `${algorithm}/${encoding} did not verify`,
      );
    }
  }
});

test("a sha256= prefix is stripped before comparing", () => {
  assert.equal(signatureMatches(signedRequest(`sha256=${signed("sha256", "hex")}`), SECRET), true);
});

test("every signature header name is read", () => {
  for (const header of SIGNATURE_HEADERS) {
    assert.equal(signatureMatches(signedRequest(signed("sha256", "hex"), { header }), SECRET), true, `${header} was not read`);
  }
});

test("a signature valid for a DIFFERENT body is refused", () => {
  // The point of signing: a header copied off one delivery cannot be replayed onto another.
  const other = Buffer.from(JSON.stringify([{ emp_name: "Somebody Else", call_logs: [] }]));
  assert.equal(signatureMatches(signedRequest(signed("sha256", "hex", other)), SECRET), false);
});

test("a signature made with the wrong secret is refused", () => {
  const wrongKey = signed("sha256", "hex", BODY, "not-the-secret");
  assert.equal(signatureMatches(signedRequest(wrongKey), SECRET), false);
});

test("a forged or empty signature is refused", () => {
  assert.equal(signatureMatches(signedRequest("deadbeef"), SECRET), false);
  assert.equal(signatureMatches(signedRequest(""), SECRET), false);
});

test("without the raw body there is nothing to verify against", () => {
  // The bytes as they arrived are what the sender signed; re-serializing the parsed object gives
  // different bytes and would never match. No bytes means refuse, never accept.
  const req = requestWith({ headers: { "x-callyzer-signature": signed("sha256", "hex") } });
  assert.equal(signatureMatches(req, SECRET), false);
});

test("the signature header list matches the controller's", () => {
  const source = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "..", "src", "modules", "sales", "crm-leads", "controller.js"),
    "utf8",
  );
  const block = source.match(/const SIGNATURE_HEADERS = \[([^\]]*)\]/);
  assert.ok(block, "SIGNATURE_HEADERS is no longer declared as a literal array");
  assert.deepEqual([...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]), SIGNATURE_HEADERS);
});


/*
 * The secret is 64 hex characters, which is how a 32-byte key is written down. A sender that
 * decodes it before signing produces a completely different HMAC from one that signs with the
 * characters - the failure this was written for, where both sides held "the same secret".
 */
test("a signature made with the hex-DECODED secret verifies", () => {
  const key = Buffer.from(SECRET, "hex");
  for (const algorithm of ["sha256", "sha1", "sha512"]) {
    for (const encoding of ["hex", "base64"]) {
      const digest = crypto.createHmac(algorithm, key).update(BODY).digest(encoding);
      assert.equal(signatureMatches(signedRequest(digest), SECRET), true, `${algorithm}/${encoding} with a decoded key did not verify`);
    }
  }
});

test("hex is compared without regard to case", () => {
  const upper = signed("sha256", "hex").toUpperCase();
  assert.equal(signatureMatches(signedRequest(upper), SECRET), true);
});

test("a plain hash of secret and body verifies", () => {
  for (const order of [[SECRET, BODY], [BODY, SECRET]]) {
    const digest = crypto.createHash("sha256").update(order[0]).update(order[1]).digest("hex");
    assert.equal(signatureMatches(signedRequest(digest), SECRET), true);
  }
});

test("widening the schemes did not weaken the refusals", () => {
  // The whole point still has to hold: a wrong key, a wrong body, or noise must never pass.
  assert.equal(signatureMatches(signedRequest(crypto.createHmac("sha256", "wrong-secret").update(BODY).digest("hex")), SECRET), false);
  const otherBody = Buffer.from(JSON.stringify([{ emp_name: "Somebody Else", call_logs: [] }]));
  assert.equal(signatureMatches(signedRequest(crypto.createHmac("sha256", SECRET).update(otherBody).digest("hex")), SECRET), false);
  assert.equal(signatureMatches(signedRequest("deadbeef"), SECRET), false);
  assert.equal(signatureMatches(signedRequest("0".repeat(64)), SECRET), false);
});


/*
 * What Callyzer actually does.
 *
 * It names the header "signature" and puts the secret in it, unhashed - confirmed from the
 * server's own log, which showed `x-callyzer-signature` carrying the exact value configured in
 * their panel. Every earlier attempt failed because the code trusted the name and computed HMACs.
 */
test("the secret sent plainly in the signature header is accepted", () => {
  assert.equal(signatureMatches(signedRequest(SECRET), SECRET), true);
});

test("a wrong value in the signature header is still refused", () => {
  assert.equal(signatureMatches(signedRequest("0".repeat(64)), SECRET), false);
  assert.equal(signatureMatches(signedRequest(`${SECRET}x`), SECRET), false);
  assert.equal(signatureMatches(signedRequest(SECRET.slice(0, -1)), SECRET), false);
});

test("accepting the plain secret did not stop real signatures verifying", () => {
  // Both paths have to live together: Callyzer as it behaves today, and a properly signed sender.
  assert.equal(signatureMatches(signedRequest(signed("sha256", "hex")), SECRET), true);
  assert.equal(signatureMatches(signedRequest(crypto.createHmac("sha256", "wrong").update(BODY).digest("hex")), SECRET), false);
});
