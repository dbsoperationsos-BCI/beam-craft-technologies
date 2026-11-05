const { listBoard } = require("./read");
const { respond } = require("../production/http");

/** `GET /shoots?from=YYYY-MM-DD&to=YYYY-MM-DD` - the viewer's shoots dated in the range. */
async function listShoots(req, res) {
  try {
    return res.json({ data: await listBoard(req.user.id, { from: req.query.from, to: req.query.to }) });
  } catch (error) {
    return respond(res, error, "Unable to load the shoot board.");
  }
}

module.exports = { listShoots };
