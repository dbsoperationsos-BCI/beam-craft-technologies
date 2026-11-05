import test from "node:test";
import assert from "node:assert/strict";
import { formatFileSize, readWindowsRelease } from "../src/lib/desktopRelease.mjs";

test("a published https installer reads as a release with its own file name", () => {
  const release = readWindowsRelease({
    url: "https://downloads.example.com/desktop/Virtual%20Curation%20Desktop_0.1.0_x64-setup.exe",
    version: " 0.1.0 ",
    sizeBytes: "105907383",
  });
  assert.deepEqual(release, {
    url: "https://downloads.example.com/desktop/Virtual%20Curation%20Desktop_0.1.0_x64-setup.exe",
    fileName: "Virtual Curation Desktop_0.1.0_x64-setup.exe",
    installerType: "EXE",
    version: "0.1.0",
    size: "101 MB",
  });
  assert.equal(readWindowsRelease({ url: "https://x.example/a/Setup.MSI" }).installerType, "MSI");
});

test("nothing published, or an address that is not an installer, reads as no release", () => {
  for (const url of [undefined, "", "   ", "not a url", "http://x.example/setup.exe", "https://x.example/", "https://x.example/setup.zip", "javascript:alert(1)"]) {
    assert.equal(readWindowsRelease({ url }), null, String(url));
  }
});

test("file sizes are shown only when known", () => {
  assert.equal(formatFileSize(undefined), "");
  assert.equal(formatFileSize("abc"), "");
  assert.equal(formatFileSize(0), "");
  assert.equal(formatFileSize(2048), "2 KB");
  assert.equal(formatFileSize(155171078), "148 MB");
  assert.equal(formatFileSize(1.5 * 1024 ** 3), "1.5 GB");
});
