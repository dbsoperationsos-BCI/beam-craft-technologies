// The signed-in person's photo is shown in two places at once - My Profile, where it is set, and
// the top bar, which is on every screen. Saving it on the one announces it to the other, so the
// face beside the name changes the moment the photo does rather than on the next reload.
export const PROFILE_PHOTO_CHANGED_EVENT = "dbs:profile-photo-changed";

export function announceProfilePhotoChanged(photoUrl) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(PROFILE_PHOTO_CHANGED_EVENT, { detail: { photoUrl: photoUrl || null } }));
}
