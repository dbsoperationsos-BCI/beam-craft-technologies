import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * A dialog that is a form, opened from inside another form (Settings, any SchemaFormPanel), must not
 * be a <form> inside a <form>: HTML forbids it and React reports a hydration error. It is drawn into
 * <body>, and its submit stops there, so Enter in it never submits the form that opened it.
 */

const DIALOG = fs.readFileSync(path.join(process.cwd(), "src", "components", "ui", "Dialog.js"), "utf8");

test("a form dialog is portalled to <body>; a plain one stays where it is", () => {
  assert.match(DIALOG, /import \{ createPortal \} from "react-dom";/);
  assert.match(DIALOG, /if \(!onSubmit\) return dialog;\s+return mounted \? createPortal\(dialog, document\.body\) : null;/);
});

test("its submit stops at its own form", () => {
  assert.match(DIALOG, /const submit = onSubmit \? \(event\) => \{ event\.stopPropagation\(\); onSubmit\(event\); \} : undefined;/);
  assert.match(DIALOG, /<Card\s+ref=\{dialogRef\}\s+onSubmit=\{submit\}/);
});
