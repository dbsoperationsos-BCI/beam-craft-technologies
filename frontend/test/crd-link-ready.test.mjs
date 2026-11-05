import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { CRD_LINK_TEMPLATE_KEY, crdLinkMessage } from "../src/lib/crdDocumentLink.mjs";

const read = (...parts) => fs.readFileSync(path.join(import.meta.dirname, "..", "src", ...parts), "utf8");
const PAGE = read("components", "sales", "CrdDocumentsPage.js");
const DIALOG = read("components", "sales", "CrdLinkReadyDialog.js");

test("the message is the studio's CRD Document Link template, filled in", () => {
  assert.equal(CRD_LINK_TEMPLATE_KEY, "CRD_DOCUMENT_LINK");
  const template = { key: CRD_LINK_TEMPLATE_KEY, body: "Hi {client name} ({event id}), fill this in: {crd link}" };
  assert.equal(crdLinkMessage(template, { clientName: "WED Priya & Arjun", eventId: "DBS-EV-1", crdLink: "https://os.example/crd/abc" }), "Hi WED Priya & Arjun (DBS-EV-1), fill this in: https://os.example/crd/abc");
  // No template: the wording it was seeded with.
  const fallback = crdLinkMessage(null, { clientName: "WED Priya & Arjun", crdLink: "https://os.example/crd/abc" });
  assert.match(fallback, /^Hi WED Priya & Arjun,\n\nPlease fill in your CRD document here:\nhttps:\/\/os\.example\/crd\/abc/);
});

test("Create Link while the link has not gone out, Send Link once it has; creating it moves the row to Yet To Receive", () => {
  assert.match(PAGE, /const linkNotSent = \(row\) => !row\.standalone && row\.status === "Link Not sent";/);
  assert.match(PAGE, /label: linkNotSent\(document\) \? "Create Link" : "Send Link"/);
  // A row that has not gone out always asks the server for its link - which is what marks it Sent -
  // even when the document was raised beforehand and already knows its path.
  assert.match(PAGE, /if \(!linkNotSent\(project\)\) \{/);
  assert.match(PAGE, /const response = await createCrdDocumentLink\(project\.id\);/);
  assert.match(PAGE, /status: "Yet To Receive"/);
  assert.match(PAGE, /\{sendLinkProject && <CrdLinkReadyDialog row=\{sendLinkProject\} link=\{sendLinkUrl\} onClose=\{closeSendLink\} \/>\}/);
  assert.doesNotMatch(PAGE, /wa\.me|whatsappShareUrl|Send CRD Link/, "the old wa.me dialog is gone");
});

test("CRD Link Ready: the message with Copy, Send WhatsApp into the project's group, and Done", () => {
  assert.match(DIALOG, /title="CRD Link Ready"/);
  assert.match(DIALOG, /<ShareableMessage label="Message to send them" message=\{message\} rows=\{8\} onTextChange=\{setMessageText\} \/>/);
  assert.match(DIALOG, /await sendCrdLinkToGroup\(projectId, text\);/);
  assert.match(DIALOG, />Done<\/Button>/);
  // A document with no project has no group: Send WhatsApp says why, Copy still works.
  assert.match(DIALOG, /const projectId = row\?\.standalone \? null : row\?\.id;/);
  assert.match(DIALOG, /\? "This document has no project yet, so there is no WhatsApp group to send to\. Copy the message instead\."/);
  // The group is asked first and named on the button: nothing goes to a group the sender has not seen.
  assert.match(DIALOG, /getCrdLinkGroup\(projectId\)/);
  assert.match(DIALOG, /label=\{group\.subject \? `Send to "\$\{group\.subject\}"` : "Send WhatsApp"\}/);
  assert.match(DIALOG, /: group\.problem \|\| \(group\.subject \? "" : "Finding the project's WhatsApp group\.\.\."\)/);
  assert.match(DIALOG, /\{canSend && <SendWhatsAppButton/, "shown only to somebody whose WhatsApp is linked");
  assert.match(read("services", "sales", "crd-documents.service.js"), /\/api\/sales\/crd-documents\/\$\{encodeURIComponent\(projectId\)\}\/whatsapp-group/);
});

test("the wording is edited in Settings → Message Templates → CRD Document Link", () => {
  assert.match(read("components", "settings", "SettingsOverlay.js"), /templateKey="CRD_DOCUMENT_LINK"/);
  assert.match(read("components", "settings", "MessageTemplatePanel.js"), /CRD_DOCUMENT_LINK: \{\s+"client name":/);
});
