import test from "node:test";
import assert from "node:assert/strict";
import { enqueueUploads, markUpload, dropUpload, retryUploads, nextWaiting, uploadsOf } from "../src/lib/productionUploads.mjs";

const PNG = "data:image/png;base64,iVBORw0KGgo=";

test("photos are queued one item each, in the order they were taken", () => {
  const queue = enqueueUploads([], "HAPPENING_NOW", [PNG, PNG]);
  assert.equal(queue.length, 2);
  assert.deepEqual(queue.map((item) => [item.kind, item.status, item.data]), [["HAPPENING_NOW", "waiting", PNG], ["HAPPENING_NOW", "waiting", PNG]]);
  assert.equal(nextWaiting(queue).id, queue[0].id);
  assert.notEqual(queue[0].id, queue[1].id);
});

test("every camera photo gets a name of its own, so the failed list tells them apart", () => {
  const queue = [...enqueueUploads([], "HAPPENING_NOW", [PNG, PNG]), ...enqueueUploads([], "HAPPENING_NOW", [PNG])];
  const names = queue.map((item) => item.name);
  assert.equal(new Set(names).size, 3);
  for (const name of names) assert.match(name, /^Photo \d+\.jpg$/);
});

test("a ticket keeps its file name", () => {
  const [item] = enqueueUploads([], "TICKET", [{ name: "train.pdf", data: "data:application/pdf;base64,JVBERi0=" }]);
  assert.equal(item.name, "train.pdf");
});

test("a ticket upload carries the travel mode being picked; everything else carries none", () => {
  const [ticket] = enqueueUploads([], "TICKET", [{ name: "train.pdf", data: "data:application/pdf;base64,JVBERi0=" }], { travelMode: "Train" });
  assert.equal(ticket.travelMode, "Train");
  const [photo] = enqueueUploads([], "HAPPENING_NOW", [PNG]);
  assert.equal(photo.travelMode, null);
});

test("a failed upload stays queued with its reason", () => {
  let queue = enqueueUploads([], "HAPPENING_NOW", [PNG, PNG]);
  queue = dropUpload(queue, queue[0].id);
  queue = markUpload(queue, queue[0].id, "failed", "Network error");
  assert.deepEqual(uploadsOf(queue, "HAPPENING_NOW"), { items: queue, left: 0, failed: 1 });
  assert.equal(queue[0].error, "Network error");
  assert.equal(nextWaiting(queue), null, "a failed photo is not retried behind the person's back");
});

test("retry puts only the failed ones of that kind back", () => {
  let queue = [...enqueueUploads([], "HAPPENING_NOW", [PNG]), ...enqueueUploads([], "TICKET", [{ name: "t.pdf", data: "d" }])];
  queue = markUpload(markUpload(queue, queue[0].id, "failed", "x"), queue[1].id, "failed", "y");
  queue = retryUploads(queue, "HAPPENING_NOW");
  assert.deepEqual(queue.map((item) => item.status), ["waiting", "failed"]);
  assert.equal(queue[0].error, "");
});
