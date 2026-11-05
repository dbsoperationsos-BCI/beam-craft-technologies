"use client";
import ArrowForward from "@mui/icons-material/ArrowForward";
import Button from "@/components/shared/Button";
import PublicGalleryLazyImage from "./PublicGalleryLazyImage";

// The thumbnail strip's tiles. When the folder holds more, the last tile is still a photo, with the
// count of everything it stands for ("+48") laid over it.
const STRIP = 5;

/**
 * The gallery home's folder cards - name, "52 photos · 5 selected", the way in, and a strip of the
 * folder's first photos - for the All Photos tab.
 *
 * `folderSelected` reads the count for the selection item on screen off a folder, and `locked`
 * (the item is submitted) turns the button from a choice into a look. `previews` on a folder are
 * the server's first few thumbnails of it - thumbnails only, lazily loaded, never an original.
 *
 * The strip is a way in too: pressing it opens the folder exactly as Select Photos does. It is one
 * control, not five, and it never touches a selection - picking happens inside the folder. It is
 * left out of the Tab order because Select Photos beside it is the same door for the keyboard.
 */
export default function FolderCardList({ folders = [], folderSelected, locked = false, onOpenFolder, emptyMessage, sessionToken }) {
  return (
    <div className="max-w-2xl space-y-4">
      {folders.length ? (
        folders.map((folder) => {
          const previews = (folder.previews || []).slice(0, STRIP);
          // The last tile stands for itself and every photo not drawn, so a folder of 52 reads +48.
          const overflow = folder.total > previews.length && previews.length === STRIP ? folder.total - (STRIP - 1) : 0;
          return (
            // On a phone the card stacks - name and count, the strip, then Select Photos full width
            // at the bottom: the header row dissolves (`contents`) and `order` moves the same
            // button below the strip. From `sm` up it is the row it always was.
            <article key={folder.folderId} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm max-sm:flex max-sm:flex-col sm:p-5">
              <div className="flex items-start justify-between gap-3 max-sm:contents">
                <div className="min-w-0 max-sm:order-1">
                  <h2 className="wrap-break-word text-lg font-semibold leading-snug text-slate-900 sm:text-xl">{folder.name}</h2>
                  {/* The count alone, not "3/5": the limit belongs to the selection item across
                      every folder, so a ratio on one card read as that folder's own quota. The
                      limit is already stated once, in the heading above the cards. */}
                  <p className="mt-1 text-[13px] text-slate-500 sm:text-sm">
                    <span className="whitespace-nowrap">{folder.total} {folder.total === 1 ? "photo" : "photos"}</span> · <span className="whitespace-nowrap">{folderSelected(folder)} selected</span>
                  </p>
                </div>
                {/* After the selection is submitted the folder is view-only, and the button
                    says so — the same door, no longer promising a choice. */}
                <Button type="button" variant="primary" size="none" onClick={() => onOpenFolder(folder.folderId)} className="h-10 shrink-0 gap-1.5 whitespace-nowrap rounded-lg px-3 !text-sm max-sm:order-3 max-sm:mt-4 max-sm:h-11 max-sm:w-full max-sm:!text-[15px] sm:gap-2 sm:px-4">
                  {locked ? "See Photos" : "Select Photos"} <ArrowForward style={{ fontSize: 16 }} />
                </Button>
              </div>
              {previews.length > 0 && (
                <Button
                  type="button"
                  variant="plain"
                  size="none"
                  onClick={() => onOpenFolder(folder.folderId)}
                  tabIndex={-1}
                  ariaLabel={`Open ${folder.name} - ${folder.total} ${folder.total === 1 ? "photo" : "photos"}`}
                  className="mt-4 w-full rounded-lg max-sm:order-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                >
                  <span className="grid w-full grid-cols-5 gap-1.5 sm:gap-2">
                    {previews.map((image, index) => (
                      <span key={image.id} className="relative block aspect-4/5 overflow-hidden rounded-lg bg-slate-100 sm:aspect-square">
                        <PublicGalleryLazyImage src={image.thumbnailUrl} alt="" sessionToken={sessionToken} className="h-full w-full" />
                        {overflow > 0 && index === STRIP - 1 && (
                          <span className="absolute inset-0 grid place-items-center bg-slate-900/55 text-base font-semibold text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.6)] sm:text-lg">+{overflow}</span>
                        )}
                      </span>
                    ))}
                  </span>
                </Button>
              )}
            </article>
          );
        })
      ) : (
        <p className="py-12 text-center text-sm text-slate-500">{emptyMessage}</p>
      )}
    </div>
  );
}
