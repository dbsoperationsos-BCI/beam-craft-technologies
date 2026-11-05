import assert from "node:assert/strict";
import test from "node:test";
import { collectFolderIds, toggleExpandedFolder } from "../src/lib/folderTreeUtils.mjs";

const folders = [{ id: "root", children: [{ id: "child", children: [{ id: "grandchild", children: [] }] }] }];

test("collectFolderIds expands every existing folder by default", () => {
  assert.deepEqual([...collectFolderIds(folders)], ["root", "child", "grandchild"]);
});

test("toggleExpandedFolder collapses and re-expands without replacing other state", () => {
  const expanded = new Set(["root", "child"]);
  const collapsed = toggleExpandedFolder(expanded, "child");
  assert.deepEqual([...collapsed], ["root"]);
  assert.deepEqual([...toggleExpandedFolder(collapsed, "child")], ["root", "child"]);
  assert.deepEqual([...expanded], ["root", "child"]);
});
