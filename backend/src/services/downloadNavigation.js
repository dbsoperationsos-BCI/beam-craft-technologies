/**
 * A client's download is a page load, not a fetch: the browser is pointed at the file so the page
 * never holds its bytes. A refusal answered in JSON to a page load replaces the client's own page
 * with that JSON. So a request the browser made as a page load (asking for HTML before JSON) is sent
 * back to the client's page with `?download=failed`, where the page says the download did not go
 * through; a fetch keeps its JSON answer exactly as before.
 */
const wantsPage = (req) => req.accepts(["json", "html"]) === "html";

function backToPage(res, pageUrl) {
  return res.redirect(303, `${pageUrl}${pageUrl.includes("?") ? "&" : "?"}download=failed`);
}

module.exports = { wantsPage, backToPage };
