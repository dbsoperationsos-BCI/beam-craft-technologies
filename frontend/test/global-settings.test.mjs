import assert from "node:assert/strict";
import test from "node:test";
import {
  announceTableSettingsSaved,
  OPEN_GLOBAL_SETTINGS_EVENT,
  openGlobalSettings,
  TABLE_SETTINGS_SAVED_EVENT,
} from "../src/lib/globalSettings.js";

class TestCustomEvent extends Event {
  constructor(type, options = {}) {
    super(type);
    this.detail = options.detail;
  }
}

function withBrowserEvents(run) {
  const previousWindow = globalThis.window;
  const previousCustomEvent = globalThis.CustomEvent;
  globalThis.window = new EventTarget();
  globalThis.CustomEvent = TestCustomEvent;
  try {
    run();
  } finally {
    globalThis.window = previousWindow;
    globalThis.CustomEvent = previousCustomEvent;
  }
}

test("a module shortcut opens Settings at its requested section", () => {
  withBrowserEvents(() => {
    let received;
    window.addEventListener(OPEN_GLOBAL_SETTINGS_EVENT, (event) => { received = event.detail; });
    openGlobalSettings({ section: "table-settings" });
    assert.deepEqual(received, { section: "table-settings" });
  });
});

test("saved table settings are announced to the open Lead page", () => {
  withBrowserEvents(() => {
    let received;
    window.addEventListener(TABLE_SETTINGS_SAVED_EVENT, (event) => { received = event.detail; });
    const fields = [{ key: "venue", label: "Venue" }];
    announceTableSettingsSaved("Dum Dum", fields);
    assert.deepEqual(received, { vertical: "Dum Dum", fields });
  });
});
