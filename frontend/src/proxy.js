import { NextResponse } from "next/server";

/*
 * Runs before a route renders - only for a client's invoice link (`/i/<token>`).
 *
 * A person opening the link goes **straight to the PDF**, redirected before any page is drawn, so no
 * summary card shows first; the phone's viewer reads and downloads it. The page itself is left for
 * what fetches a link to draw its preview card - WhatsApp's included - which needs its name and logo,
 * and for a dead link: the PDF route sends the browser back with `?unavailable=1`, and the page says
 * the invoice is not available. Nothing is looked up here: the API's miss limiter counts per visitor,
 * and a check from this server would put every visitor behind its one address.
 *
 * Here rather than in the page because the app's `loading.js` starts the page streaming at once, and
 * a redirect from a streamed page arrives as a refresh after the page has shown.
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5001";
const LINK_PREVIEW_AGENTS = /WhatsApp|facebookexternalhit|Facebot|Twitterbot|TelegramBot|Slackbot|LinkedInBot|Discordbot|Googlebot|bingbot/i;

export function proxy(request) {
  const token = request.nextUrl.pathname.split("/")[2] || "";
  if (!token || request.nextUrl.searchParams.has("unavailable")) return NextResponse.next();
  if (LINK_PREVIEW_AGENTS.test(request.headers.get("user-agent") || "")) return NextResponse.next();
  return NextResponse.redirect(`${API_URL}/api/public/invoices/${encodeURIComponent(token)}/pdf`, 307);
}

export const config = {
  matcher: "/i/:token",
};
