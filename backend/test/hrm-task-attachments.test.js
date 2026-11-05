const test = require("node:test");
const assert = require("node:assert/strict");
const attachments = require("../src/modules/hrm/tasks/attachments");
const { attachmentList, nextAttachmentId } = require("../src/modules/hrm/tasks/service");

/*
 * What may be handed over with a task, and where it is filed.
 *
 * Both are the kind of rule that fails quietly. A type check that is too loose accepts something
 * the studio never meant to store and only says so when somebody opens it; a key that is not
 * unique overwrites a file that was already there, and the write succeeds either way.
 */

const file = (originalname, mimetype) => ({ originalname, mimetype });

test("the file types the studio attaches to a task are accepted", () => {
  for (const [name, type] of [
    ["brief.pdf", "application/pdf"],
    ["reference.jpg", "image/jpeg"],
    ["shot.png", "image/png"],
    ["from-a-phone.heic", "image/heic"],
    ["plan.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["costs.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    ["list.csv", "text/csv"],
    ["notes.txt", "text/plain"],
    ["everything.zip", "application/zip"],
  ]) {
    assert.equal(attachments.isAllowedFile(file(name, type)), true, name);
  }
});

test("a file the browser could not place is judged by its own extension", () => {
  // Chrome sends application/octet-stream for a .docx often enough that refusing on the type alone
  // would be refusing the file for the browser's uncertainty rather than for what it is.
  assert.equal(attachments.isAllowedFile(file("plan.docx", "application/octet-stream")), true);
  assert.equal(attachments.isAllowedFile(file("shot.HEIC", "application/octet-stream")), true);
});

test("anything else is refused, by type and by extension alike", () => {
  assert.equal(attachments.isAllowedFile(file("installer.exe", "application/x-msdownload")), false);
  assert.equal(attachments.isAllowedFile(file("script.sh", "text/x-shellscript")), false);
  /*
   * The one a type check alone would let through.
   *
   * A declared MIME type is a claim the browser makes, not a fact about the bytes - so an
   * executable that says it is a PNG passes any check that trusts it, and downloads under the name
   * it came with. The extension is what the file actually becomes on somebody's machine, so an
   * extension off the list refuses the file whatever it claims to be.
   */
  assert.equal(attachments.isAllowedFile(file("payload.exe", "image/png")), false);
  // With no extension there is nothing but the type to go on, and it has to be one of ours.
  assert.equal(attachments.isAllowedFile(file("no-extension", "application/x-msdownload")), false);
  assert.equal(attachments.isAllowedFile(file("no-extension", "image/png")), true);
  assert.equal(attachments.isAllowedFile({}), false);
});

test("a task's files are filed under its code, in the folder its type belongs to", () => {
  const key = attachments.buildAttachmentKey({ taskCode: "TSK-000042", taskId: 42, mimetype: "image/png", fileName: "shot.png" });
  assert.equal(key, "hrm/tasks/TSK-000042/images/shot.png");
  assert.equal(
    attachments.buildAttachmentKey({ taskCode: "TSK-000042", taskId: 42, mimetype: "application/pdf", fileName: "brief.pdf" }),
    "hrm/tasks/TSK-000042/files/brief.pdf",
  );
});

test("a task with no code still has somewhere to file its files", () => {
  assert.equal(attachments.taskFolder("", 7), "task-7");
  // And a code that arrives with anything a path cannot carry is reduced rather than refused.
  assert.equal(attachments.taskFolder("TSK/000042 ..", 7), "TSK-000042-..");
});

test("the name is made safe before it becomes a key", () => {
  const key = attachments.buildAttachmentKey({ taskCode: "TSK-1", taskId: 1, mimetype: "image/png", fileName: "../../etc/passwd.png" });
  // A traversal in the picked name cannot climb out of the task's own folder.
  assert.equal(key.startsWith("hrm/tasks/TSK-1/images/"), true);
  assert.equal(key.includes(".."), false);
});

/*
 * The list itself, which lives in one JSON column on the task.
 *
 * That is the trade a column makes for a table: no auto-increment and no per-row delete, so the id
 * is minted here and the whole list is rewritten on every change. Both are cheap to get wrong in a
 * way nothing on screen would show — a reused id serves the wrong file to a kept link, and a list
 * read from a column that is null throws on a task nobody attached anything to.
 */

test("a task with no files at all reads as an empty list, whatever the column holds", () => {
  assert.deepEqual(attachmentList({ attachments: null }), []);
  assert.deepEqual(attachmentList({}), []);
  assert.deepEqual(attachmentList(null), []);
  // A column written as something that is not a list is not trusted into one either.
  assert.deepEqual(attachmentList({ attachments: { name: "brief.pdf" } }), []);
});

test("an attachment id is the highest the task has reached, plus one", () => {
  assert.equal(nextAttachmentId([]), 1);
  assert.equal(nextAttachmentId([{ id: 1 }, { id: 2 }]), 3);
});

test("a removed file's id is never handed to the next one", () => {
  // The list after removing #2 of three. Numbering by length or by position would call the next
  // file 3 - which is a link somebody kept now serving a different file.
  const afterRemoval = [{ id: 1 }, { id: 3 }];
  assert.equal(nextAttachmentId(afterRemoval), 4);
});
