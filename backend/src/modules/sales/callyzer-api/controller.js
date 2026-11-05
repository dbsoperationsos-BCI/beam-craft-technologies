const { REPORTS, isConfigured } = require("./service");
const { CallyzerRequestError } = require("./validation");
const { CallyzerApiError } = require("./client");

/**
 * The reports, proxied through this server.
 *
 * The browser never talks to Callyzer directly: the AccessKey would have to be in the page for
 * that, and a key in a page is a key anyone can read. The CRM asks this server, this server holds
 * the credential.
 */

/** Whether the integration is usable, so a dashboard can say "not configured" rather than fail. */
function status(_req, res) {
  return res.json({ data: { configured: isConfigured() } });
}

async function report(req, res) {
  const name = String(req.params.report || "").trim();
  const fetcher = REPORTS[name];
  if (!fetcher) {
    return res.status(404).json({ message: `Unknown Callyzer report '${name}'.` });
  }

  try {
    return res.json({ data: await fetcher(req.body || {}) });
  } catch (error) {
    // A bad request is the caller's - their message names the field and is worth showing. Anything
    // else is Callyzer's or the network's, and is reported as a gateway problem rather than as a
    // fault in the CRM.
    if (error instanceof CallyzerRequestError) return res.status(400).json({ message: error.message });
    if (error instanceof CallyzerApiError) return res.status(error.status).json({ message: error.message });
    console.error("Callyzer report failed:", error?.message || error);
    return res.status(500).json({ message: "Unable to load that Callyzer report." });
  }
}

module.exports = { status, report };
