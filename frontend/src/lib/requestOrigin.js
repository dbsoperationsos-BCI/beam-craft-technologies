import { headers } from "next/headers";
import { shareOrigin } from "./shareMetadata.mjs";

/**
 * The origin the current request was made on, for metadata the server renders - see `shareOrigin`.
 * Server components and `generateMetadata` only.
 */
export async function requestOrigin() {
  const incoming = await headers();
  return shareOrigin({
    configured: process.env.NEXT_PUBLIC_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || "",
    host: incoming.get("x-forwarded-host") || incoming.get("host") || "",
    proto: incoming.get("x-forwarded-proto") || "",
  });
}
