import PublicApplicationForm from "@/components/interview/PublicApplicationForm";

// Never indexed. The token in the URL is the whole of the secrecy here, and a link that reaches
// a crawler - forwarded, pasted into a chat that previews it, opened in a browser that syncs
// history - would otherwise be searchable by anybody. The same line every other public
// token page in this tree carries.
export const metadata = { title: "Job Application | DBS", robots: { index: false, follow: false } };

/*
 * The candidate's own application form, outside the `(app)` route group so it gets no app shell and
 * needs no session - the same arrangement `/onboarding/apply/[token]` has. The token in the path is
 * the short code the Interview screen's link carries, or the long token of a link raised before.
 */
export default async function PublicApplicationPage({ params }) {
  const { token } = await params;
  return <PublicApplicationForm token={token} />;
}
