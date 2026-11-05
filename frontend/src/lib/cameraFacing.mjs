/**
 * Whether a live camera faces the person holding it - a phone's front camera, or a laptop's webcam -
 * so its preview should read like a mirror, the way the phone's own camera, WhatsApp and Meet show
 * it. Mirrored or not is the preview's alone: the photo taken stays the true picture, so text in it
 * reads the right way round.
 *
 * Asked of the camera actually in use rather than of the one requested, because a request is only a
 * preference: a laptop asked for its back camera hands over the webcam. The browser says which way a
 * camera faces in the track's `facingMode` where it knows; a phone's back camera always says so, and
 * what says nothing is a webcam - which faces you. A label naming the back or rear camera is believed
 * where the facing is missing.
 */
export function facesUser(stream) {
  const track = stream?.getVideoTracks?.()[0];
  if (!track) return false;
  const facing = track.getSettings?.().facingMode;
  if (facing === "user") return true;
  if (facing === "environment") return false;
  return !/\b(back|rear|environment)\b/i.test(track.label || "");
}
