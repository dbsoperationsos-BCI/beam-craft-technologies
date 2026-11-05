import ClientGalleryWelcome from "./ClientGalleryWelcome";

/**
 * The client gallery before a session exists: the welcome screen, its PIN box and the studio's badge.
 *
 * Everything on the gallery meta is forwarded whole rather than named one prop at a time. Naming them
 * is what broke the studio's branding: `studioName` and `galleryLogoUrl` travel on the meta and were
 * spread into this component correctly, but they were not among the props it listed, so it rebuilt the
 * gallery object without them. An uploaded logo reached this point and went no further — every
 * welcome screen showed the bundled fallback instead, however many times the studio picked a logo.
 *
 * Forwarding the rest means a value added to the meta later cannot be dropped here in the same way.
 */
export default function PinGate({ onVerify, onViewPhotos, ...gallery }) {
  return <ClientGalleryWelcome gallery={gallery} onVerify={onVerify} onViewPhotos={onViewPhotos} />;
}
