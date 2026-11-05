import { renderMessageOr } from "./messageTemplate.mjs";

/** The CRD Document Link template (Settings → Message Templates), and the server's key for it. */
export const CRD_LINK_TEMPLATE_KEY = "CRD_DOCUMENT_LINK";

/**
 * The message that hands a client their CRD form, in the studio's CRD Document Link wording, filled
 * in. Where the studio has no such template (a row somebody deleted), the wording it was seeded with,
 * so CRD Link Ready always has something to copy and send.
 */
export function crdLinkMessage(template, { clientName, eventId, crdLink }) {
  const values = {
    "client name": String(clientName || "").trim() || "there",
    "event id": String(eventId || "").trim(),
    "crd link": crdLink,
  };
  const fallback = [
    `Hi ${values["client name"]},`,
    "",
    "Please fill in your CRD document here:",
    crdLink,
    "",
    "It opens without a sign-in and saves as you go, so you can come back to it.",
  ].join("\n");
  return renderMessageOr(fallback, template, values);
}
