const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const zlib = require("node:zlib");
const express = require("express");
const { compressResponses } = require("../src/middleware/compressResponses");

/*
 * The lists go out gzipped; an event stream does not, or its messages would arrive in one lump at
 * the end.
 */
function serve() {
  const app = express();
  app.use(compressResponses);
  app.get("/list", (req, res) => res.json({ data: Array.from({ length: 500 }, (_, i) => ({ id: i, name: "Grand Palace Hall wedding shoot" })) }));
  app.get("/stream", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.flushHeaders();
    res.write("event: ping\ndata: {}\n\n");
    res.end();
  });
  return new Promise((resolve) => { const server = app.listen(0, () => resolve(server)); });
}

const get = (port, path) => new Promise((resolve, reject) => {
  http.get({ port, path, headers: { "Accept-Encoding": "gzip" } }, (res) => {
    const chunks = [];
    res.on("data", (chunk) => chunks.push(chunk));
    res.on("end", () => resolve({ headers: res.headers, body: Buffer.concat(chunks) }));
  }).on("error", reject);
});

test("JSON is gzipped and much smaller; an event stream is sent as it is", async () => {
  const server = await serve();
  try {
    const { port } = server.address();
    const list = await get(port, "/list");
    assert.equal(list.headers["content-encoding"], "gzip");
    const plain = zlib.gunzipSync(list.body);
    assert.equal(JSON.parse(plain).data.length, 500);
    assert.ok(list.body.length < plain.length / 5, `gzipped ${list.body.length} of ${plain.length} bytes`);
    const stream = await get(port, "/stream");
    assert.equal(stream.headers["content-encoding"], undefined);
    assert.match(stream.body.toString(), /event: ping/);
  } finally {
    server.close();
  }
});
