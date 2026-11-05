import AdminAlbumPreview from "@/components/image-selection/signature-album/AdminAlbumPreview";
import PermissionsProvider from "@/components/auth/PermissionsProvider";

export const metadata = { title: "Signature Album Preview", robots: { index: false, follow: false } };

// The studio's preview of a Signature Album: the client's page, drawn by the client's own view from
// the client's own content builder, behind the studio's login and the album's permission. Outside
// the app shell, so it is the whole viewport - the workspace shows it in an iframe sized like the
// device being previewed, which is what makes its breakpoints, its 100svh cover and its crop the
// client's own rather than the admin window's. `?edit=1` is the Design tab's Edit Album
// Preview, where the cover and every photo can be dragged into place - for a viewer who may write the
// album, so the permissions are read here, outside the app shell; each save keeps its own guard.
export default async function SignatureAlbumPreviewPage({ params, searchParams }) {
  const { albumId } = await params;
  const { edit } = await searchParams;
  return <PermissionsProvider><AdminAlbumPreview albumId={albumId} editRequested={edit === "1"} /></PermissionsProvider>;
}
