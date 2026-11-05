const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * The public CRD link opens the client's form, instead of telling them "Project not found."
 *
 * A CRD link is authenticated by its token: there is no signed-in caller behind it, so there is no
 * data scope to hold it to either. When the register was scoped, `findLiveProject` grew an `access`
 * argument and `accessOrNothing` beneath it - which answers "no access resolved" with a `where`
 * that matches nothing, on purpose, so a controller that forgets to resolve one leaks nothing.
 *
 * `subjectForDocument` kept calling `findLiveProject(row.projectId)` with no second argument. Every
 * project-backed document therefore resolved to that empty rule and threw 404 "Project not found.",
 * which is what the client saw when they opened the link they had been sent - and what the studio
 * saw on Send Link's own Open Form. Only documents raised by hand still worked, because those have
 * no project to look up.
 *
 * Checked statically rather than by calling the route, which would need a database: the reader the
 * token-authenticated paths use must be the unscoped one, and it must not be handed an access rule
 * that no unauthenticated caller can ever produce.
 */

const SERVICE = path.join(__dirname, "..", "src", "modules", "sales", "crd-documents", "service.js");

/** The body of a named `async function` in the service, up to the next top-level declaration. */
function bodyOf(source, name) {
  const start = source.indexOf(`async function ${name}(`);
  assert.notEqual(start, -1, `${name} is no longer a function in the CRD document service`);
  const end = source.indexOf("\nasync function ", start + 1);
  const next = source.indexOf("\nfunction ", start + 1);
  const stop = [end, next].filter((index) => index !== -1).sort((left, right) => left - right)[0];
  return source.slice(start, stop === undefined ? source.length : stop);
}

test("the token-authenticated CRD readers resolve their project unscoped", () => {
  const source = fs.readFileSync(SERVICE, "utf8");
  const subject = bodyOf(source, "subjectForDocument");

  assert.doesNotMatch(
    subject,
    /findLiveProject\(/,
    "subjectForDocument reads a project for callers who hold no data scope - the public form, and the "
      + "share link - so it must not go through the access-scoped reader, which answers an absent rule "
      + "with a filter that matches nothing",
  );
  assert.match(subject, /readProject\(/, "subjectForDocument no longer reads the project it stands in for");

  // And the access-scoped reader is still exactly that, for the studio-side paths that do resolve one.
  assert.match(bodyOf(source, "findLiveProject"), /accessOrNothing\(access\)/);
  assert.match(bodyOf(source, "ensureLink"), /findLiveProject\(projectId, access\)/);
});

test("the public CRD paths take no access rule at all", () => {
  const source = fs.readFileSync(SERVICE, "utf8");

  // Each of these is reached by token alone. A signature that grew an `{ access }` would mean some
  // caller was expected to resolve one, and no unauthenticated request can.
  for (const name of ["readByToken", "saveDraftByToken", "submitByToken", "readResponseByShareToken"]) {
    const signature = source.match(new RegExp(`async function ${name}\\(([^)]*)\\)`))?.[1];
    assert.ok(signature !== undefined, `${name} is no longer a function in the CRD document service`);
    assert.doesNotMatch(signature, /access/, `${name} is opened by a token, not by a signed-in caller`);
  }
});
