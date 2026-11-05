import PublicApplicationForm from "@/components/interview/PublicApplicationForm";

/*
 * The candidate's own application form, outside the `(app)` route group so it gets no app shell and
 * needs no session - the same arrangement `/onboarding/apply/[token]` has. The token in the path is
 * the short code the Interview screen's link carries, or the long token of a link raised before.
 */
export default async function PublicApplicationPage({ params }) {
  const { token } = await params;
  return <PublicApplicationForm token={token} />;
}
