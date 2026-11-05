import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { facesUser } from "../src/lib/cameraFacing.mjs";

/*
 * A camera facing the person - a phone's front camera, a laptop's webcam - previews like a mirror, as
 * the phone's own camera does. A photo of a thing stays the true picture; the attendance selfie is kept
 * as the person saw it, mirrored. Asked of the camera in use,
 * since a laptop asked for its back camera hands over the webcam.
 */

const read = (...parts) => fs.readFileSync(path.join(process.cwd(), "src", ...parts), "utf8");
const streamWith = (settings, label = "") => ({ getVideoTracks: () => [{ getSettings: () => settings, label }] });

test("a camera that faces the person is mirrored; one that faces away is not", () => {
  assert.equal(facesUser(streamWith({ facingMode: "user" })), true);
  assert.equal(facesUser(streamWith({ facingMode: "environment" })), false);
  // A laptop webcam says nothing about its facing: it faces you.
  assert.equal(facesUser(streamWith({}, "Integrated Webcam (0bda:5634)")), true);
  // Where the facing is missing, a label naming the back camera is believed.
  assert.equal(facesUser(streamWith({}, "camera2 0, facing back")), false);
  assert.equal(facesUser(null), false);
});

test("both camera screens mirror the preview by the camera in use; the attendance selfie is kept as it was seen", () => {
  const dialog = read("components", "shared", "CameraCaptureDialog.js");
  assert.match(dialog, /setMirrored\(facesUser\(stream\)\);/);
  assert.match(dialog, /className=\{`aspect-video w-full object-contain \$\{mirrored \? "-scale-x-100" : ""\}`\}/);
  // Photos of things - a document, a product - stay the true picture.
  assert.match(dialog, /drawImage\(video, 0, 0, canvas\.width, canvas\.height\)/);
  assert.doesNotMatch(dialog, /scale\(-1, 1\)/);
  const attendance = read("components", "hrm", "EmployeeAttendancePage.js");
  assert.match(attendance, /setMirrored\(facesUser\(stream\)\);/);
  assert.match(attendance, /object-cover \$\{mirrored \? "-scale-x-100" : ""\}/);
  // The login and logout selfie is drawn mirrored where its preview was, so it comes out as the person saw it.
  assert.match(attendance, /if \(mirrored\) \{ context\.translate\(canvas\.width, 0\); context\.scale\(-1, 1\); \}\s*context\.drawImage\(video, 0, 0\);/);
});
