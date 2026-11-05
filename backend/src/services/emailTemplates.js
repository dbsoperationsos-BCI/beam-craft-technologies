/**
 * The HTML the studio's emails are drawn with.
 *
 * Kept apart from `emailService.js` so that file stays about transport — who the mail goes to and
 * how it leaves the server — while this one owns what it looks like. A template returns
 * `{ subject, text, html }` and nothing else; it never sends, so it can be read and rendered
 * without SMTP configured.
 *
 * Email is not the web. Every rule below is a workaround for a client that ignores what a browser
 * would honour, and none of it should be tidied into the stylesheet it looks like it wants to be:
 *
 * - Styles are inline. Gmail strips a `<style>` block on forwarded mail and Outlook.com rewrites it,
 *   so the layout has to survive without one. The block in `<head>` carries the mobile query alone,
 *   and only ever *relaxes* what the inline styles already say.
 * - Layout is tables. Outlook renders through Word, which has no flexbox and no float worth using.
 * - Nothing is fetched. No web fonts, no logo file, no tracking pixel — an image blocked by default
 *   is a hole in the design, and a font that never loads is a fallback nobody chose.
 * - Colours are stated on every element. A client that forces its own dark theme inverts what it can
 *   see; text that inherited its colour from an ancestor is the text that ends up unreadable.
 */

/** Text from a record — a candidate's name, their designation — before it is put inside markup. */
const escapeHtml = (value) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

const BRAND = "Don’t Blink Studioz";
const PRODUCT = "DBS Operations OS";

/** The studio's palette, the same slate-and-blue the app is built in. */
const COLOR = {
  page: "#f1f5f9",
  card: "#ffffff",
  border: "#e2e8f0",
  heading: "#0f172a",
  body: "#475569",
  muted: "#64748b",
  faint: "#94a3b8",
  accent: "#2563eb",
  noticeBg: "#eff6ff",
  noticeBorder: "#bfdbfe",
  noticeText: "#1e40af",
  warnBg: "#fffbeb",
  warnBorder: "#fde68a",
  warnText: "#92400e",
  codeBg: "#f8fafc",
};

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
/** For anything that has to be copied character by character, where l and 1 must not look alike. */
const MONO = "Menlo, Consolas, 'Courier New', monospace";

/**
 * The date an invite dies, in the studio's own timezone.
 *
 * Always IST and always labelled as such: the recipient may open this anywhere, and "23:59" with no
 * zone against it is a deadline they can only guess at.
 */
const formatExpiry = (expiresAt) => `${new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
}).format(new Date(expiresAt))} IST`;

/**
 * The frame every studio email shares: the wordmark above, the white card, the footer beneath.
 *
 * `preheader` is the line the inbox shows beside the subject before anything is opened. It is hidden
 * in the body itself and followed by a run of zero-width characters, which is what stops the client
 * from filling the rest of that preview with whatever text comes next.
 */
function layout({ title, preheader, body }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(title)}</title>
<style>
  /* Phones only, and only to loosen: everything here is already correct inline at 600px. */
  @media only screen and (max-width: 620px) {
    .dbs-card-cell { padding: 24px !important; }
    .dbs-shell { padding: 16px 12px !important; }
    .dbs-heading { font-size: 20px !important; }
    .dbs-button a { display: block !important; }
  }
</style>
</head>
<body style="margin:0; padding:0; width:100%; background-color:${COLOR.page}; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%;">
  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px; color:${COLOR.page};">${escapeHtml(preheader)}</div>
  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all;">&#8199;&#65279;&#847; &#8199;&#65279;&#847; &#8199;&#65279;&#847; &#8199;&#65279;&#847; &#8199;&#65279;&#847; &#8199;&#65279;&#847; &#8199;&#65279;&#847; &#8199;&#65279;&#847;</div>

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${COLOR.page};">
    <tr>
      <td class="dbs-shell" align="center" style="padding:32px 16px;">

        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:100%; max-width:600px;">
          <tr>
            <td align="left" style="padding:0 4px 16px;">
              <p style="margin:0; font-family:${FONT}; font-size:15px; font-weight:700; letter-spacing:0.14em; text-transform:uppercase; color:${COLOR.heading};">${BRAND}</p>
              <p style="margin:4px 0 0; font-family:${FONT}; font-size:12px; letter-spacing:0.08em; text-transform:uppercase; color:${COLOR.faint};">${PRODUCT}</p>
            </td>
          </tr>

          <tr>
            <td style="background-color:${COLOR.card}; border:1px solid ${COLOR.border}; border-radius:12px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td class="dbs-card-cell" style="padding:32px;">
${body}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td align="left" style="padding:20px 4px 0;">
              <p style="margin:0; font-family:${FONT}; font-size:12px; line-height:20px; color:${COLOR.faint};">
                Sent by ${PRODUCT} on behalf of ${BRAND}.<br>
                This is an automated message — please do not reply to it.
              </p>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** A paragraph inside the card, at the one size and leading the card's prose uses. */
const paragraph = (html, marginTop = 16) => `<p style="margin:${marginTop}px 0 0; font-family:${FONT}; font-size:15px; line-height:24px; color:${COLOR.body};">${html}</p>`;

/**
 * The one thing the reader is being asked to do, drawn as a filled cell with the link stretched
 * across it — a bordered `<a>` alone collapses to its text in Outlook, leaving a button-shaped
 * outline that is only clickable on the words.
 */
const button = (url, label) => `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 0;">
  <tr>
    <td class="dbs-button" align="center" bgcolor="${COLOR.accent}" style="border-radius:8px;">
      <a href="${escapeHtml(url)}" style="display:inline-block; padding:14px 28px; font-family:${FONT}; font-size:15px; font-weight:600; line-height:20px; color:#ffffff; text-decoration:none; border-radius:8px;">${escapeHtml(label)}</a>
    </td>
  </tr>
</table>`;

/** The deadline, or anything else the reader must not skim past, in a tinted box of its own. */
const notice = (html) => `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:24px 0 0;">
  <tr>
    <td style="padding:14px 16px; background-color:${COLOR.noticeBg}; border:1px solid ${COLOR.noticeBorder}; border-radius:8px;">
      <p style="margin:0; font-family:${FONT}; font-size:14px; line-height:22px; color:${COLOR.noticeText};">${html}</p>
    </td>
  </tr>
</table>`;

/**
 * One labelled fact, for a value the reader should check rather than act on.
 *
 * The reset email names the account it is for, so somebody with two addresses can see which one this
 * is about before they press anything - and somebody who has no account here can see it is not
 * theirs.
 */
const detail = (label, value) => `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:20px 0 0;">
  <tr>
    <td style="padding:12px 16px; background-color:${COLOR.noticeBg}; border:1px solid ${COLOR.noticeBorder}; border-radius:8px;">
      <p style="margin:0; font-family:${FONT}; font-size:12px; font-weight:600; letter-spacing:0.06em; text-transform:uppercase; color:${COLOR.accent};">${label}</p>
      <p style="margin:4px 0 0; font-family:${FONT}; font-size:15px; line-height:22px; font-weight:600; color:${COLOR.heading}; word-break:break-all;">${value}</p>
    </td>
  </tr>
</table>`;

/** The same box as `notice`, in amber, for the line that is a caution rather than a fact. */
const warning = (html) => `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:16px 0 0;">
  <tr>
    <td style="padding:14px 16px; background-color:${COLOR.warnBg}; border:1px solid ${COLOR.warnBorder}; border-radius:8px;">
      <p style="margin:0; font-family:${FONT}; font-size:14px; line-height:22px; color:${COLOR.warnText};">${html}</p>
    </td>
  </tr>
</table>`;

/**
 * One credential, in a box of its own with the label above it.
 *
 * Monospace and on its own line because this is text somebody retypes into a login form: a password
 * set in the body font is one where O and 0 are a guess, and a password inside a sentence is one
 * that gets copied with the full stop attached. `user-select:all` lets a tap select the whole value
 * in the clients that honour it, and costs nothing in the ones that do not.
 */
const credential = (label, value) => `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:12px 0 0;">
  <tr>
    <td style="padding:0 0 6px;">
      <p style="margin:0; font-family:${FONT}; font-size:12px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:${COLOR.muted};">${escapeHtml(label)}</p>
    </td>
  </tr>
  <tr>
    <td style="padding:10px 14px; background-color:${COLOR.codeBg}; border:1px solid ${COLOR.border}; border-radius:8px;">
      <p style="margin:0; font-family:${MONO}; font-size:15px; line-height:22px; font-weight:600; color:${COLOR.heading}; word-break:break-all; -webkit-user-select:all; user-select:all;">${escapeHtml(value)}</p>
    </td>
  </tr>
</table>`;

/** A titled list. Email clients disagree about `<ul>` indentation, so the rows are a table. */
const checklist = (heading, items) => `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:28px 0 0;">
  <tr>
    <td style="padding:0 0 8px;">
      <p style="margin:0; font-family:${FONT}; font-size:12px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:${COLOR.muted};">${escapeHtml(heading)}</p>
    </td>
  </tr>
  ${items.map((item) => `<tr>
    <td style="padding:4px 0;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td width="16" valign="top" style="width:16px; font-family:${FONT}; font-size:15px; line-height:24px; color:${COLOR.accent};">&bull;</td>
          <td style="font-family:${FONT}; font-size:15px; line-height:24px; color:${COLOR.body};">${escapeHtml(item)}</td>
        </tr>
      </table>
    </td>
  </tr>`).join("")}
</table>`;

/** What the candidate has to have in front of them to finish the form in one sitting. */
const ONBOARDING_CHECKLIST = [
  "Your Aadhaar and PAN numbers, and a clear photo of each",
  "Your bank account number and IFSC code",
  "An emergency contact, and two people who can act as references",
  "Your nominee's name, relationship and date of birth",
];

/**
 * The invite that asks a new joiner to fill in their own details.
 *
 * It is written to be read by somebody who does not work here yet: it says who it is from before it
 * asks for anything, names the deadline in a box rather than a sentence, and lists what to have
 * ready — the form asks for identity, bank and nominee details, and a candidate who starts it
 * without those to hand abandons it halfway and asks for a fresh link.
 *
 * The link is also printed as text beneath the button. Some clients strip the button, some readers
 * are on a device that cannot open it, and a link nobody can copy is an invite nobody can accept.
 */
function onboardingInviteEmail({ candidateName, onboardingUrl, expiresAt, intendedDesignation }) {
  const expiryText = formatExpiry(expiresAt);
  const role = (intendedDesignation || "").trim();
  const roleLine = role
    ? `You have been invited to join ${BRAND} as <strong style="color:${COLOR.heading};">${escapeHtml(role)}</strong>, and the last step before you start is your own details.`
    : `You have been invited to join ${BRAND}, and the last step before you start is your own details.`;

  const body = `
<p style="margin:0; font-family:${FONT}; font-size:14px; font-weight:600; letter-spacing:0.06em; text-transform:uppercase; color:${COLOR.accent};">Onboarding invite</p>
<h1 class="dbs-heading" style="margin:8px 0 0; font-family:${FONT}; font-size:24px; line-height:32px; font-weight:700; color:${COLOR.heading};">Hi ${escapeHtml(candidateName)},</h1>
${paragraph(roleLine)}
${paragraph("Use the secure link below to complete your onboarding form. It takes about ten minutes, and everything you enter goes straight to our HR team.")}
${button(onboardingUrl, "Complete your onboarding")}
${paragraph(`If the button does not work, copy this link into your browser:<br><a href="${escapeHtml(onboardingUrl)}" style="color:${COLOR.accent}; text-decoration:underline; word-break:break-all;">${escapeHtml(onboardingUrl)}</a>`, 20)}
${notice(`This link expires on <strong>${escapeHtml(expiryText)}</strong>. After that it stops working and our HR team will have to send you a new one.`)}
${checklist("What to keep ready", ONBOARDING_CHECKLIST)}
${paragraph(`The link is personal to you, so please do not forward it. If you were not expecting this invite, you can ignore this email — nothing happens until the form is submitted.`, 28)}
${paragraph(`Regards,<br><strong style="color:${COLOR.heading};">${PRODUCT}</strong><br>${BRAND}`, 28)}`;

  const text = [
    `Hi ${candidateName},`,
    "",
    role
      ? `You have been invited to join ${BRAND} as ${role}, and the last step before you start is your own details.`
      : `You have been invited to join ${BRAND}, and the last step before you start is your own details.`,
    "",
    "Use this secure link to complete your onboarding form. It takes about ten minutes, and everything you enter goes straight to our HR team.",
    onboardingUrl,
    "",
    `This link expires on ${expiryText}. After that it stops working and our HR team will have to send you a new one.`,
    "",
    "WHAT TO KEEP READY",
    ...ONBOARDING_CHECKLIST.map((item) => `- ${item}`),
    "",
    "The link is personal to you, so please do not forward it. If you were not expecting this invite, you can ignore this email — nothing happens until the form is submitted.",
    "",
    "Regards,",
    PRODUCT,
    BRAND,
    "",
    "This is an automated message — please do not reply to it.",
  ].join("\n");

  return {
    subject: `${BRAND} - Complete Your ${PRODUCT} Onboarding`,
    text,
    html: layout({
      title: `Complete your ${PRODUCT} onboarding`,
      // What the inbox shows beside the subject: the deadline, which is the part that decides
      // whether this gets opened today or next week.
      preheader: `Your onboarding link is ready. It expires on ${expiryText}.`,
      body,
    }),
  };
}

/**
 * The offboarding form, sent to somebody who is leaving.
 *
 * Deliberately a quieter letter than the onboarding invite: nobody needs "welcome" wording on their
 * way out, and the one thing it has to be clear about is what the form decides - the day their
 * notice starts, and so their last working day. The notice period is stated because it is what HR
 * asked for when the form was raised, and reading it in the email is how somebody notices it is
 * wrong before filling anything in.
 */
function offboardingInviteEmail({ employeeName, offboardingUrl, expiresAt, noticePeriodDays }) {
  const expiryText = formatExpiry(expiresAt);
  const days = Number(noticePeriodDays) || 0;
  const noticeLine = days === 1 ? "1 day of notice" : `${days} days of notice`;

  const body = `
<p style="margin:0; font-family:${FONT}; font-size:14px; font-weight:600; letter-spacing:0.06em; text-transform:uppercase; color:${COLOR.accent};">Offboarding form</p>
<h1 class="dbs-heading" style="margin:8px 0 0; font-family:${FONT}; font-size:24px; line-height:32px; font-weight:700; color:${COLOR.heading};">Hi ${escapeHtml(employeeName)},</h1>
${paragraph(`Our HR team has raised your offboarding at ${BRAND}. The form below is where you tell us when your notice begins.`)}
${paragraph(`You are to serve <strong style="color:${COLOR.heading};">${escapeHtml(noticeLine)}</strong>, and the form works out your expected last working day from the date you give it.`)}
${button(offboardingUrl, "Fill in your offboarding form")}
${paragraph(`If the button does not work, copy this link into your browser:<br><a href="${escapeHtml(offboardingUrl)}" style="color:${COLOR.accent}; text-decoration:underline; word-break:break-all;">${escapeHtml(offboardingUrl)}</a>`, 20)}
${notice(`This link expires on <strong>${escapeHtml(expiryText)}</strong>. After that it stops working and our HR team will have to send you a new one.`)}
${paragraph("Nothing changes until HR has read what you send: they confirm the dates with you, and your last working day is set from that.", 28)}
${paragraph(`The link is personal to you, so please do not forward it. If you were not expecting this, speak to HR before filling anything in.`, 28)}
${paragraph(`Regards,<br><strong style="color:${COLOR.heading};">${PRODUCT}</strong><br>${BRAND}`, 28)}`;

  const text = [
    `Hi ${employeeName},`,
    "",
    `Our HR team has raised your offboarding at ${BRAND}. The form below is where you tell us when your notice begins.`,
    "",
    `You are to serve ${noticeLine}, and the form works out your expected last working day from the date you give it.`,
    "",
    "Fill in your offboarding form:",
    offboardingUrl,
    "",
    `This link expires on ${expiryText}. After that it stops working and our HR team will have to send you a new one.`,
    "",
    "Nothing changes until HR has read what you send: they confirm the dates with you, and your last working day is set from that.",
    "",
    "The link is personal to you, so please do not forward it. If you were not expecting this, speak to HR before filling anything in.",
    "",
    "Regards,",
    PRODUCT,
    BRAND,
    "",
    "This is an automated message — please do not reply to it.",
  ].join("\n");

  return {
    subject: `${BRAND} - Your Offboarding Form`,
    text,
    html: layout({
      title: "Your offboarding form",
      preheader: `Tell us when your notice begins. This link expires on ${expiryText}.`,
      body,
    }),
  };
}

/**
 * The offboarding form handed back for a correction.
 *
 * Its own template rather than the invite above sent twice, because what it has to say is different:
 * the form is not new, nothing they filled in is lost, and the one thing worth reading is HR's
 * remark saying what to look at. The counterpart of `onboardingSendBackEmail` below, and deliberately
 * the same shape - somebody asked to come back to a form should meet the same email either end of
 * their employment.
 */
function offboardingSendBackEmail({ employeeName, offboardingUrl, expiresAt, remark }) {
  const expiryText = formatExpiry(expiresAt);

  const body = `
<p style="margin:0; font-family:${FONT}; font-size:14px; font-weight:600; letter-spacing:0.06em; text-transform:uppercase; color:${COLOR.accent};">Offboarding form</p>
<h1 class="dbs-heading" style="margin:8px 0 0; font-family:${FONT}; font-size:24px; line-height:32px; font-weight:700; color:${COLOR.heading};">Hi ${escapeHtml(employeeName)},</h1>
${paragraph(`Our HR team has sent your offboarding form back for a correction. Everything you filled in is still on it - open the same link, change what needs changing, and send it again.`)}
${notice(`<strong>What HR has asked you to look at:</strong><br>${escapeHtml(remark || "").replace(/\n/g, "<br>")}`)}
${button(offboardingUrl, "Open your offboarding form")}
${paragraph(`If the button does not work, copy this link into your browser:<br><a href="${escapeHtml(offboardingUrl)}" style="color:${COLOR.accent}; text-decoration:underline; word-break:break-all;">${escapeHtml(offboardingUrl)}</a>`, 20)}
${paragraph(`The link is open until <strong style="color:${COLOR.heading};">${escapeHtml(expiryText)}</strong>.`, 24)}
${paragraph("Nothing about your employment has changed, and your resignation has not been refused - HR simply needs the form corrected before they confirm your dates.", 28)}
${paragraph(`Regards,<br><strong style="color:${COLOR.heading};">${PRODUCT}</strong><br>${BRAND}`, 28)}`;

  const text = [
    `Hi ${employeeName},`,
    "",
    "Our HR team has sent your offboarding form back for a correction. Everything you filled in is still on it - open the same link, change what needs changing, and send it again.",
    "",
    "What HR has asked you to look at:",
    remark || "",
    "",
    "Open your offboarding form:",
    offboardingUrl,
    "",
    `The link is open until ${expiryText}.`,
    "",
    "Nothing about your employment has changed, and your resignation has not been refused - HR simply needs the form corrected before they confirm your dates.",
    "",
    "Regards,",
    PRODUCT,
    BRAND,
    "",
    "This is an automated message - please do not reply to it.",
  ].join("\n");

  return {
    subject: `${BRAND} - Your Offboarding Form Needs A Correction`,
    text,
    html: layout({
      title: "Your offboarding form needs a correction",
      preheader: `HR has sent your form back. The link is open until ${expiryText}.`,
      body,
    }),
  };
}

/** What an applicant is asked to have to hand, which is far shorter than what a new employee is. */
const APPLICATION_CHECKLIST = [
  "Your up-to-date résumé, as a PDF or Word file",
  "Your education and work history, with years",
  "Your current and expected salary, and your notice period",
  "A link to your portfolio or work samples, if you have one",
];

/**
 * The application form a candidate is sent from the Interview screen.
 *
 * The onboarding invite's shape, said for somebody who has not been taken on: they have applied,
 * or been approached, and the studio would like the rest of their application from them. The
 * position goes in where the onboarding mail names the designation, for the same reason - a mail
 * that names the role reads as addressed to them rather than as a form the studio wants filled in.
 */
function interviewApplicationEmail({ candidateName, applicationUrl, expiresAt, position }) {
  const expiryText = formatExpiry(expiresAt);
  const role = (position || "").trim();
  const roleLine = role
    ? `Thank you for your interest in the <strong style="color:${COLOR.heading};">${escapeHtml(role)}</strong> position at ${BRAND}. To take your application forward, we would like a few more details from you.`
    : `Thank you for your interest in joining ${BRAND}. To take your application forward, we would like a few more details from you.`;

  const body = `
<p style="margin:0; font-family:${FONT}; font-size:14px; font-weight:600; letter-spacing:0.06em; text-transform:uppercase; color:${COLOR.accent};">Application form</p>
<h1 class="dbs-heading" style="margin:8px 0 0; font-family:${FONT}; font-size:24px; line-height:32px; font-weight:700; color:${COLOR.heading};">Hi ${escapeHtml(candidateName)},</h1>
${paragraph(roleLine)}
${paragraph("Use the secure link below to complete your application form. It takes about ten minutes, and everything you enter goes straight to our HR team.")}
${button(applicationUrl, "Complete your application")}
${paragraph(`If the button does not work, copy this link into your browser:<br><a href="${escapeHtml(applicationUrl)}" style="color:${COLOR.accent}; text-decoration:underline; word-break:break-all;">${escapeHtml(applicationUrl)}</a>`, 20)}
${notice(`This link expires on <strong>${escapeHtml(expiryText)}</strong>. After that it stops working and our HR team will have to send you a new one.`)}
${checklist("What to keep ready", APPLICATION_CHECKLIST)}
${paragraph(`The link is personal to you, so please do not forward it. If you were not expecting this email, you can ignore it — nothing happens until the form is submitted.`, 28)}
${paragraph(`Regards,<br><strong style="color:${COLOR.heading};">${PRODUCT}</strong><br>${BRAND}`, 28)}`;

  const text = [
    `Hi ${candidateName},`,
    "",
    role
      ? `Thank you for your interest in the ${role} position at ${BRAND}. To take your application forward, we would like a few more details from you.`
      : `Thank you for your interest in joining ${BRAND}. To take your application forward, we would like a few more details from you.`,
    "",
    "Use this secure link to complete your application form. It takes about ten minutes, and everything you enter goes straight to our HR team.",
    applicationUrl,
    "",
    `This link expires on ${expiryText}. After that it stops working and our HR team will have to send you a new one.`,
    "",
    "WHAT TO KEEP READY",
    ...APPLICATION_CHECKLIST.map((item) => `- ${item}`),
    "",
    "The link is personal to you, so please do not forward it. If you were not expecting this email, you can ignore it — nothing happens until the form is submitted.",
    "",
    "Regards,",
    PRODUCT,
    BRAND,
    "",
    "This is an automated message — please do not reply to it.",
  ].join("\n");

  return {
    subject: `${BRAND} - Complete Your Application${role ? ` for ${role}` : ""}`,
    text,
    html: layout({
      title: `Complete your application${role ? ` for ${role}` : ""}`,
      preheader: `Your application form is ready. It expires on ${expiryText}.`,
      body,
    }),
  };
}

/**
 * Resend: the candidate already submitted their application once and HR needs it looked at again.
 *
 * The Interview module's counterpart of `onboardingSendBackEmail` below, and a separate template
 * from `interviewApplicationEmail` above for exactly the reason that one is separate from the
 * onboarding invite: a candidate who has already filled the form once and is told to "complete your
 * application" a second time reads it as a mistake, or as a form that swallowed what they typed.
 * Here they are told plainly that what they sent was read, that something needs another look, and
 * that the link reopens with all of their own answers still in it - which is true, because the
 * answers were written onto their register row and `prefillFrom` reads them straight back.
 *
 * Same link, same deadline box, same checklist, same footer - only what asks for the click changes.
 */
function interviewApplicationResendEmail({ candidateName, applicationUrl, expiresAt, position }) {
  const expiryText = formatExpiry(expiresAt);
  const role = (position || "").trim();
  const roleLine = role
    ? `We have gone through the application you sent us for the <strong style="color:${COLOR.heading};">${escapeHtml(role)}</strong> position at ${BRAND}, and a few details need another look before we can take it forward.`
    : `We have gone through the application you sent us, and a few details need another look before we can take it forward.`;

  const body = `
<p style="margin:0; font-family:${FONT}; font-size:14px; font-weight:600; letter-spacing:0.06em; text-transform:uppercase; color:${COLOR.accent};">Action needed on your application</p>
<h1 class="dbs-heading" style="margin:8px 0 0; font-family:${FONT}; font-size:24px; line-height:32px; font-weight:700; color:${COLOR.heading};">Hi ${escapeHtml(candidateName)},</h1>
${paragraph(roleLine)}
${paragraph("Use the secure link below to open your application form again. Everything you entered the first time is already filled in — just review it, correct what needs changing, and submit it once more.")}
${button(applicationUrl, "Review your application")}
${paragraph(`If the button does not work, copy this link into your browser:<br><a href="${escapeHtml(applicationUrl)}" style="color:${COLOR.accent}; text-decoration:underline; word-break:break-all;">${escapeHtml(applicationUrl)}</a>`, 20)}
${notice(`This link expires on <strong>${escapeHtml(expiryText)}</strong>. After that it stops working and our HR team will have to send you a new one.`)}
${checklist("Have this ready in case it needs updating", APPLICATION_CHECKLIST)}
${paragraph(`The link is personal to you, so please do not forward it. If you have any questions about what needs changing, reach out to our HR team before resubmitting.`, 28)}
${paragraph(`Regards,<br><strong style="color:${COLOR.heading};">${PRODUCT}</strong><br>${BRAND}`, 28)}`;

  const text = [
    `Hi ${candidateName},`,
    "",
    role
      ? `We have gone through the application you sent us for the ${role} position at ${BRAND}, and a few details need another look before we can take it forward.`
      : `We have gone through the application you sent us, and a few details need another look before we can take it forward.`,
    "",
    "Use this secure link to open your application form again. Everything you entered the first time is already filled in - just review it, correct what needs changing, and submit it once more.",
    applicationUrl,
    "",
    `This link expires on ${expiryText}. After that it stops working and our HR team will have to send you a new one.`,
    "",
    "HAVE THIS READY IN CASE IT NEEDS UPDATING",
    ...APPLICATION_CHECKLIST.map((item) => `- ${item}`),
    "",
    "The link is personal to you, so please do not forward it. If you have any questions about what needs changing, reach out to our HR team before resubmitting.",
    "",
    "Regards,",
    PRODUCT,
    BRAND,
    "",
    "This is an automated message — please do not reply to it.",
  ].join("\n");

  return {
    subject: `${BRAND} - Update Your Application${role ? ` for ${role}` : ""}`,
    text,
    html: layout({
      title: `Update your application${role ? ` for ${role}` : ""}`,
      preheader: `A few details need another look. Your link expires on ${expiryText}.`,
      body,
    }),
  };
}

/**
 * Sent Back: HR has already read what the candidate submitted and needs it corrected before it can
 * be approved. This is not the invite above sent again — a candidate who already filled the form
 * once and is told to "complete your onboarding" a second time reads it as a mistake, or a form
 * that swallowed what they typed. Here they are told plainly that their details were reviewed and
 * need another look, and that the link reopens with everything they entered still in it.
 *
 * Same link, same deadline box, same footer — only what asks for the click changes.
 */
function onboardingSendBackEmail({ candidateName, onboardingUrl, expiresAt, intendedDesignation }) {
  const expiryText = formatExpiry(expiresAt);
  const role = (intendedDesignation || "").trim();
  const roleLine = role
    ? `We have reviewed the onboarding details you submitted for the ${escapeHtml(role)} role, and a few of them need another look before we can take you forward.`
    : `We have reviewed the onboarding details you submitted, and a few of them need another look before we can take you forward.`;

  const body = `
<p style="margin:0; font-family:${FONT}; font-size:14px; font-weight:600; letter-spacing:0.06em; text-transform:uppercase; color:${COLOR.accent};">Action needed on your onboarding</p>
<h1 class="dbs-heading" style="margin:8px 0 0; font-family:${FONT}; font-size:24px; line-height:32px; font-weight:700; color:${COLOR.heading};">Hi ${escapeHtml(candidateName)},</h1>
${paragraph(roleLine)}
${paragraph("Use the secure link below to open your onboarding form again. Everything you entered the first time is already filled in — just review it, correct what needs changing, and submit it once more.")}
${button(onboardingUrl, "Review your onboarding details")}
${paragraph(`If the button does not work, copy this link into your browser:<br><a href="${escapeHtml(onboardingUrl)}" style="color:${COLOR.accent}; text-decoration:underline; word-break:break-all;">${escapeHtml(onboardingUrl)}</a>`, 20)}
${notice(`This link expires on <strong>${escapeHtml(expiryText)}</strong>. After that it stops working and our HR team will have to send you a new one.`)}
${checklist("Have this ready in case it needs updating", ONBOARDING_CHECKLIST)}
${paragraph(`The link is personal to you, so please do not forward it. If you have any questions about what needs changing, reach out to our HR team before resubmitting.`, 28)}
${paragraph(`Regards,<br><strong style="color:${COLOR.heading};">${PRODUCT}</strong><br>${BRAND}`, 28)}`;

  const text = [
    `Hi ${candidateName},`,
    "",
    role
      ? `We have reviewed the onboarding details you submitted for the ${role} role, and a few of them need another look before we can take you forward.`
      : `We have reviewed the onboarding details you submitted, and a few of them need another look before we can take you forward.`,
    "",
    "Use this secure link to open your onboarding form again. Everything you entered the first time is already filled in - just review it, correct what needs changing, and submit it once more.",
    onboardingUrl,
    "",
    `This link expires on ${expiryText}. After that it stops working and our HR team will have to send you a new one.`,
    "",
    "HAVE THIS READY IN CASE IT NEEDS UPDATING",
    ...ONBOARDING_CHECKLIST.map((item) => `- ${item}`),
    "",
    "The link is personal to you, so please do not forward it. If you have any questions about what needs changing, reach out to our HR team before resubmitting.",
    "",
    "Regards,",
    PRODUCT,
    BRAND,
    "",
    "This is an automated message — please do not reply to it.",
  ].join("\n");

  return {
    subject: `${BRAND} - Update Your ${PRODUCT} Onboarding Details`,
    text,
    html: layout({
      title: `Update your ${PRODUCT} onboarding details`,
      preheader: `A few details need another look. Your link expires on ${expiryText}.`,
      body,
    }),
  };
}

/**
 * The account an employee signs in with for the first time.
 *
 * Written for somebody who already works here and is being handed a tool, not sold one: the two
 * things to copy come before the prose about them, each in a box of its own, because that is the
 * whole reason this email is open.
 *
 * The password is temporary and travels in an email that will sit in an inbox afterwards, so the
 * mail says so twice — once as the instruction to change it, once as the caution not to pass it on.
 * Neither is decoration: this is the only message in the OS that carries a password at all.
 */
/**
 * The link somebody resets their own password from.
 *
 * Deliberately short on detail. A reset email goes to an address that may not belong to the person
 * who asked - that is the whole reason the flow exists - so it names no account, no username and no
 * role, and says plainly that ignoring it leaves the password alone.
 */
function passwordResetEmail({ name, email, resetUrl, expiresAt }) {
  const expiryText = formatExpiry(expiresAt);

  const body = `
<p style="margin:0; font-family:${FONT}; font-size:14px; font-weight:600; letter-spacing:0.06em; text-transform:uppercase; color:${COLOR.accent};">Password reset</p>
<h1 class="dbs-heading" style="margin:8px 0 0; font-family:${FONT}; font-size:24px; line-height:32px; font-weight:700; color:${COLOR.heading};">Hi ${escapeHtml(name || "there")},</h1>
${paragraph(`Somebody asked to reset the password for your ${PRODUCT} account. Use the button below to choose a new one.`)}
${detail("Account", escapeHtml(email || ""))}
${button(resetUrl, "Change Password")}
${paragraph(`If the button does not work, copy this link into your browser:<br><a href="${escapeHtml(resetUrl)}" style="color:${COLOR.accent}; text-decoration:underline; word-break:break-all;">${escapeHtml(resetUrl)}</a>`, 20)}
${notice(`This link expires on <strong>${escapeHtml(expiryText)}</strong> and can be used once. After that you will need to ask for another one.`)}
${paragraph("If you did not ask for this, you can ignore this email. Your password stays as it is, and nobody can change it without this link.", 28)}
${paragraph(`Regards,<br><strong style="color:${COLOR.heading};">${PRODUCT}</strong><br>${BRAND}`, 28)}`;

  const text = [
    `Hi ${name || "there"},`,
    "",
    `Somebody asked to reset the password for your ${PRODUCT} account.`,
    "",
    `Account: ${email || ""}`,
    "",
    "Use this link to choose a new one:",
    resetUrl,
    "",
    `This link expires on ${expiryText} and can be used once. After that you will need to ask for another one.`,
    "",
    "If you did not ask for this, you can ignore this email. Your password stays as it is, and nobody can change it without this link.",
    "",
    `Regards,`,
    PRODUCT,
    BRAND,
  ].join("\n");

  return {
    subject: `Reset your ${PRODUCT} password`,
    text,
    html: layout({ title: `Reset your ${PRODUCT} password`, preheader: "Use the link inside to choose a new password.", body }),
  };
}

/**
 * The email that hands somebody their first username and password.
 *
 * `systemName` is what the studio calls the thing they are being given access to — Settings →
 * Branding Logo → Login Credential Name. It is threaded through rather than read here, because a
 * template renders what it is given and nothing in this file may reach a database. Unset, blank or
 * whitespace falls back to the name shipped in `PRODUCT`: the first email a new employee gets must
 * never arrive with a hole in its subject line.
 */
function employeeCredentialsEmail({ employeeName, username, loginEmail, temporaryPassword, loginUrl, systemName }) {
  const product = String(systemName ?? "").trim() || PRODUCT;
  const body = `
<p style="margin:0; font-family:${FONT}; font-size:14px; font-weight:600; letter-spacing:0.06em; text-transform:uppercase; color:${COLOR.accent};">Your account is ready</p>
<h1 class="dbs-heading" style="margin:8px 0 0; font-family:${FONT}; font-size:24px; line-height:32px; font-weight:700; color:${COLOR.heading};">Hi ${escapeHtml(employeeName)},</h1>
${paragraph(`An account has been created for you on <strong style="color:${COLOR.heading};">${escapeHtml(product)}</strong>, the system ${BRAND} runs its work through. Sign in with the details below.`)}
${credential("Username", username)}
${loginEmail ? credential("Login email", loginEmail) : ""}
${credential("Temporary password", temporaryPassword)}
${button(loginUrl, `Sign in to ${escapeHtml(product)}`)}
${paragraph(`If the button does not work, copy this link into your browser:<br><a href="${escapeHtml(loginUrl)}" style="color:${COLOR.accent}; text-decoration:underline; word-break:break-all;">${escapeHtml(loginUrl)}</a>`, 20)}
${notice("You will be asked to choose your own password the first time you sign in. The one above stops working at that point.")}
${warning("Nobody at the studio will ever ask you for this password. Do not forward this email or share what is in it — if you think somebody else has seen it, tell HR and sign in straight away to change it.")}
${paragraph("If you were not expecting an account, tell HR before signing in.", 28)}
${paragraph(`Regards,<br><strong style="color:${COLOR.heading};">${escapeHtml(product)}</strong><br>${BRAND}`, 28)}`;

  const text = [
    `Hi ${employeeName},`,
    "",
    `An account has been created for you on ${product}, the system ${BRAND} runs its work through. Sign in with the details below.`,
    "",
    `USERNAME`,
    username,
    "",
    ...(loginEmail ? ["LOGIN EMAIL", loginEmail, ""] : []),
    `TEMPORARY PASSWORD`,
    temporaryPassword,
    "",
    "Sign in here:",
    loginUrl,
    "",
    "You will be asked to choose your own password the first time you sign in. The one above stops working at that point.",
    "",
    "Nobody at the studio will ever ask you for this password. Do not forward this email or share what is in it - if you think somebody else has seen it, tell HR and sign in straight away to change it.",
    "",
    "If you were not expecting an account, tell HR before signing in.",
    "",
    "Regards,",
    product,
    BRAND,
    "",
    "This is an automated message - please do not reply to it.",
  ].join("\n");

  return {
    subject: `${BRAND} - Your ${product} Login Credentials`,
    text,
    html: layout({
      title: `Your ${product} login credentials`,
      // The preview line says what to do, not what arrived: "your account is ready" beside a subject
      // that already says so is a preview that has told the reader nothing.
      preheader: "Your username and temporary password are inside. You will change the password when you first sign in.",
      body,
    }),
  };
}

/**
 * Beam Craft's invite to a client company: the link where it fills in its company details. Beam Craft's
 * own name, not the studio's - this is the one email here sent on Beam Craft's behalf.
 */
function clientOnboardingInviteEmail({ contactName, onboardingUrl, expiresAt }) {
  const SENDER = "Beam Craft";
  const expiryText = formatExpiry(expiresAt);
  const body = `
<p style="margin:0; font-family:${FONT}; font-size:14px; font-weight:600; letter-spacing:0.06em; text-transform:uppercase; color:${COLOR.accent};">Client onboarding</p>
<h1 class="dbs-heading" style="margin:8px 0 0; font-family:${FONT}; font-size:24px; line-height:32px; font-weight:700; color:${COLOR.heading};">Hi ${escapeHtml(contactName)},</h1>
${paragraph(`Welcome to ${SENDER}. Please complete your company's onboarding details using the secure link below.`)}
${button(onboardingUrl, "Complete company details")}
${paragraph(`If the button does not work, copy this link into your browser:<br><a href="${escapeHtml(onboardingUrl)}" style="color:${COLOR.accent}; text-decoration:underline; word-break:break-all;">${escapeHtml(onboardingUrl)}</a>`, 20)}
${notice(`This link expires on <strong>${escapeHtml(expiryText)}</strong>. After that it stops working and we will have to send you a new one.`)}
${paragraph("The link is for your company only, so please do not forward it.", 28)}
${paragraph(`Regards,<br><strong style="color:${COLOR.heading};">${SENDER}</strong>`, 28)}`;
  const text = [
    `Hi ${contactName},`,
    "",
    `Welcome to ${SENDER}. Please complete your company's onboarding details using this secure link:`,
    onboardingUrl,
    "",
    `This link expires on ${expiryText}. After that it stops working and we will have to send you a new one.`,
    "",
    "The link is for your company only, so please do not forward it.",
    "",
    "Regards,",
    SENDER,
    "",
    "This is an automated message - please do not reply to it.",
  ].join("\n");
  return {
    subject: `${SENDER} - Complete Your Company Onboarding`,
    text,
    html: layout({ title: "Complete your company onboarding", preheader: `Your onboarding link is ready. It expires on ${expiryText}.`, body }),
  };
}

module.exports = { clientOnboardingInviteEmail, onboardingInviteEmail, onboardingSendBackEmail, interviewApplicationEmail, interviewApplicationResendEmail, employeeCredentialsEmail, passwordResetEmail, escapeHtml, formatExpiry, offboardingInviteEmail, offboardingSendBackEmail };
