import { renderMessageOr } from "./messageTemplate.mjs";

/**
 * The message a client is answered with once their feedback is given, by where the feedback was
 * filed: a Completed one (Excellent or Good) is thanked and asked for a review and a follow, an
 * Issues one (Average or Poor) is told the team will sort it out. Both are the studio's templates
 * (Settings → Message Templates), and the server's keys for them.
 */
export const FEEDBACK_TEMPLATE_KEYS = { Completed: "FEEDBACK_THANK_YOU", Issues: "FEEDBACK_ISSUES" };

/** The template a feedback filed under `status` is answered with, or null for one that is neither. */
export const feedbackTemplateKey = (status) => FEEDBACK_TEMPLATE_KEYS[status] || null;

/**
 * The branch's follow links, as the `{social links}` placeholder lists them: the social media links
 * the studio added in Settings, one line each, under the label it gave them.
 */
export function socialLinksText(links) {
  return (Array.isArray(links?.customSocialLinks) ? links.customSocialLinks : [])
    .map((link) => [String(link?.label || "").trim() || "Link", String(link?.url || "").trim()])
    .filter(([, url]) => url)
    .map(([label, url]) => `${label}: ${url}`)
    .join("\n");
}

/**
 * The message for one feedback, in the studio's wording for its status, filled in. Where the studio
 * has no such template (a row somebody deleted), the wording it was seeded with - so the dialog
 * always has something to copy and send. A thank-you whose branch has no Google review link or no
 * follow links leaves that part out of the fallback rather than printing an empty heading.
 */
export function feedbackMessage(template, { status, clientName, shoot, eventId, feedbackCode, socialLinks }) {
  const reviewLink = String(socialLinks?.googleReviewUrl || "").trim();
  const followLinks = socialLinksText(socialLinks);
  const values = {
    "client name": String(clientName || "").trim() || "there",
    shoot: String(shoot || "").trim() || "shoot",
    "event id": String(eventId || "").trim(),
    // The Issues message gives the client the Feedback ID to quote.
    "feedback id": String(feedbackCode || "").trim(),
    "google review link": reviewLink,
    "social links": followLinks,
  };
  const fallback = status === "Issues"
    ? [
      `Hi ${values["client name"]},`,
      "",
      "Thank you for sharing your feedback about your project. We’ve received it and will review the issues you raised. Our team will get back to you soon.",
      "",
      values["feedback id"] ? `Please mention ${values["feedback id"]} if you contact us about your feedback. Thank you for your patience.` : "Thank you for your patience.",
    ]
    : [
      `Hi ${values["client name"]},`,
      "",
      `Thank you for your wonderful feedback on your ${values.shoot}! It means a lot to our whole team.`,
      ...(reviewLink ? ["", "If you enjoyed working with us, we would be grateful for a review here:", reviewLink] : []),
      ...(followLinks ? ["", "Follow us for more of our work:", followLinks] : []),
    ];
  return renderMessageOr(fallback.join("\n"), template, values);
}
