import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const PANEL = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "hrm", "SpeakUpPanel.js"), "utf8");
const CONFIG = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "constants", "speakUpConfig.js"), "utf8");

test("a table of the employee's own past Speak-ups, not everyone's", () => {
  assert.match(PANEL, /import DataTable from "@\/components\/data-table\/DataTable";/);
  assert.match(PANEL, /import \{ .*createSpeakUp, getMySpeakUps, fetchSpeakUpAttachment.* \} from "@\/services\/hrm\/speakUp\.service";/);
  assert.doesNotMatch(PANEL, /getAllSpeakUps/);
  assert.match(PANEL, /data=\{mine\}/);
});

test("Add Speak-up opens a plain pop-up dialog, not the full-screen schema form", () => {
  assert.match(PANEL, /import Dialog from "@\/components\/ui\/Dialog";/);
  assert.match(PANEL, /\{adding && <Dialog/);
  assert.doesNotMatch(PANEL, /SchemaFormPanel/);
});

test("carries the reassurance copy, exactly, from the shared config", () => {
  assert.match(CONFIG, /export const SPEAK_UP_REASSURANCE = "Your complaint will not be exposed to anyone\. This is kept personal — say anything you want to tell\.";/);
  assert.match(PANEL, /\{SPEAK_UP_REASSURANCE\}/);
});

test("the four fields, with the user's own labels", () => {
  assert.match(PANEL, /label="Type"/);
  assert.match(PANEL, /label="Subject"/);
  assert.match(PANEL, /label="What happened\?"/);
  assert.match(PANEL, /label="Attachment"/);
});

test("Type offers exactly the six values, from the shared config", () => {
  assert.match(CONFIG, /export const TYPE_OPTIONS = \["Team \/ Manager Issue", "HR \/ People", "Work Environment", "Suggestion", "App \/ System Issue", "Other"\]/);
});

test("picking Other reveals a required field to say what it actually is", () => {
  assert.match(PANEL, /\{form\.type === "Other" && <TextField/);
  const otherField = PANEL.slice(PANEL.indexOf('{form.type === "Other" && <TextField'), PANEL.indexOf('label="Subject"'));
  assert.match(otherField, /label="Please specify the issue type"/);
  assert.match(otherField, /required/);
});

test("Send refuses until Type, Subject, What happened are filled - and Other-type too, once Other is picked", () => {
  // Send stays live; pressing it marks each empty box under itself.
  assert.match(PANEL, /type: form\.type \? "" : "Choose the type\.",/);
  assert.match(PANEL, /otherType: form\.type === "Other" && isBlankText\(form\.otherType\) \? "Enter the issue type\." : "",/);
  assert.match(PANEL, /title: isBlankText\(form\.title\) \? "Enter a subject\." : "",/);
  assert.match(PANEL, /description: isBlankText\(form\.description\) \? "Say what happened\." : "",/);
  assert.match(PANEL, /if \(!fields\.check\(speakUpProblems\(\)\)\) return;/);
});

test("the Other-type answer is folded into the description sent to the server, from the shared config", () => {
  assert.match(CONFIG, /export function speakUpDescriptionFor\(values\) \{/);
  const helper = CONFIG.slice(CONFIG.indexOf("export function speakUpDescriptionFor"));
  assert.match(helper, /values\.type !== "Other"/);
  assert.match(helper, /Issue type: \$\{values\.otherType\.trim\(\)\}/);
  assert.match(PANEL, /description: speakUpDescriptionFor\(form\)/);
});

test("reuses existing field and table components - nothing raw", () => {
  assert.doesNotMatch(PANEL, /<input\b/);
  assert.doesNotMatch(PANEL, /<textarea\b/);
  assert.doesNotMatch(PANEL, /<select\b/);
  assert.doesNotMatch(PANEL, /<button\b/);
  assert.doesNotMatch(PANEL, /<table\b/);
});

test("guards double submits with useSubmitOnce rather than its own saving state", () => {
  assert.match(PANEL, /import useSubmitOnce from "@\/components\/shared\/useSubmitOnce";/);
  assert.match(PANEL, /const \{ busy, run \} = useSubmitOnce\(\);/);
  assert.match(PANEL, /busy=\{busy\}/);
  assert.match(PANEL, /onClick=\{\(\) => run\(submit\)\}/);
});

test("the attachment download in the detail view is Button's own plain/none variant, not a faked ghost link", () => {
  assert.doesNotMatch(PANEL, /variant="ghost"/);
  assert.match(PANEL, /variant="plain"/);
  assert.match(PANEL, /size="none"/);
});

test("row detail opens on double-click, through the shared RecordViewPanel", () => {
  assert.match(PANEL, /import RecordViewPanel from "@\/components\/data-table\/RecordViewPanel";/);
  assert.match(PANEL, /onRowDoubleClick=\{\(row\) => setViewingId\(row\.id\)\}/);
  assert.match(PANEL, /sections=\{speakUpDetailSections\}/);
});

test("canWrite hides the Add button but not the table", () => {
  assert.match(PANEL, /canWrite = true/);
  assert.match(PANEL, /\{canWrite && <Button variant="primary" onClick=\{openAdd\}>Add Speak-up<\/Button>\}/);
  assert.match(PANEL, /Your past Speak-ups/);
});

test("Attachment is not required, and only offers the file types the server actually accepts", () => {
  const attachment = PANEL.slice(PANEL.indexOf('label="Attachment"'), PANEL.indexOf("</div>\n      </div>\n    </Dialog>"));
  assert.doesNotMatch(attachment, /\brequired\b/);
  assert.match(PANEL, /accept=\{ACCEPTED_ATTACHMENT_TYPES\}/);
  assert.match(CONFIG, /export const ACCEPTED_ATTACHMENT_TYPES = "\.pdf,\.png,\.jpg,\.jpeg,\.webp,\.doc,\.docx,\.txt";/);
});

test("the employee's own list shows where each speak-up has got to - the status, nothing more", () => {
  assert.match(PANEL, /statusStyles: speakUpStatusStyles/);
  assert.match(PANEL, /setMine\(\(response\?\.data \|\| \[\]\)\.map\(withStatusLabel\)\)/);
});

test("the tick boxes carry Export and Delete, and Delete takes your own back only while it is pending", () => {
  /*
   * The same selection every other table in the OS has: `ADMIN / Table Select All` ("Select Table
   * Rows in Bulk") decides whether there are boxes at all, so it is a Super Admin's until the studio
   * ticks that row onto a role, and the screen's own `canWrite` is what Delete asks for on top.
   *
   * Delete goes to `/mine/bulk`, not the register's: this screen is your own submissions, and taking
   * one back is only yours to do while a reviewer has not answered it yet.
   */
  const panel = fs.readFileSync(new URL("../src/components/hrm/SpeakUpPanel.js", import.meta.url), "utf8");
  assert.match(panel, /prefix: "\/api\/hrm\/speak-up\/mine",/);
  assert.match(panel, /canDelete: canWrite,/);
  assert.match(panel, /selection: bulk\.selection,/);
  assert.match(panel, /csvExport: \{ enabled: true, fileName: "my-speak-ups"/);
  // The reload after a delete, or the table keeps showing what has gone.
  assert.match(panel, /onDeleted: \(\) => load\(\),/);
});
