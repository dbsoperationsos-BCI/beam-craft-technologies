"use client";

/**
 * Whether WhatsApp photo-match messages can actually go from this server, in the studio's words: the
 * server's own switch, the provider, the template named and whether Meta has approved it - from the
 * server's `whatsapp` answer, which never carries a token, id or raw provider error. Nothing here
 * claims a message can be sent when a part is missing. `counts` (a gallery's) adds what was sent.
 */
const TEMPLATE_WORDS = {
  APPROVED: (name) => `Template "${name}" is approved by Meta.`,
  PENDING: (name) => `Template "${name}" is waiting for Meta's approval - nothing can be sent until it is approved.`,
  NOT_FOUND: (name) => `Template "${name}" isn't in the studio's WhatsApp account.`,
  NOT_CHECKED: (name) => `Template "${name}" is named on the server; its approval isn't checked from here.`,
  UNREACHABLE: (name) => `Template "${name}" is named on the server; Meta couldn't be asked about it just now.`,
};

export function whatsappProblems(status) {
  if (!status) return ["WhatsApp status unknown."];
  const problems = [];
  if (!status.serverEnabled) problems.push("WhatsApp photo-match messages are switched off on this server. Nothing is sent until an administrator turns them on.");
  if (!status.providerReady) problems.push("The WhatsApp provider isn't set up on this server.");
  if (!status.templateConfigured) problems.push("No WhatsApp template is named for photo-match messages on this server.");
  const template = status.template?.status;
  if (status.templateConfigured && template && !["APPROVED", "NOT_CHECKED", "UNREACHABLE"].includes(template)) problems.push((TEMPLATE_WORDS[template] || ((name) => `Template "${name}" isn't usable (Meta says ${template}).`))(status.templateName));
  return problems;
}

export default function WhatsAppMessagesStatus({ status, counts = null }) {
  const problems = whatsappProblems(status);
  const template = status?.templateConfigured && status.template?.status && TEMPLATE_WORDS[status.template.status] && !problems.length ? TEMPLATE_WORDS[status.template.status](status.templateName) : null;
  return <div className="flex flex-col gap-1.5 text-xs">
    {problems.length
      ? <ul role="status" className="list-disc space-y-1 rounded-lg bg-amber-50 py-2 pl-7 pr-3 text-amber-900">{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>
      : <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-800">WhatsApp messages can be sent from this server.{template ? ` ${template}` : ""}</p>}
    {counts && <p className="text-slate-600">{counts.guests} guest{counts.guests === 1 ? "" : "s"} asked to be told · {counts.sent} message{counts.sent === 1 ? "" : "s"} sent{counts.waiting ? ` · ${counts.waiting} waiting` : ""}{counts.failed ? ` · ${counts.failed} not delivered` : ""}{counts.uncertain ? ` · ${counts.uncertain} unconfirmed` : ""}</p>}
  </div>;
}
