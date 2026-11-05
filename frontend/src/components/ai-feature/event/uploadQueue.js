/**
 * The upload queue as a plain object, outside React: files go in, a few are sent at a time, and
 * every change is reported through `onChange` as a fresh snapshot for the dialog to draw. Kept out
 * of component state so the queue survives the dialog closing - what is already on the wire
 * finishes and the batch is still reported - and so no render ever mutates it.
 *
 * `configure` replaces the callbacks; the dialog calls it from an effect so the upload function
 * always carries the folder currently chosen and the batch report reaches the current page.
 */
export function createUploadQueue({ concurrency = 3 } = {}) {
  let items = [];
  let active = 0;
  let batchOpen = false;
  let uploaded = 0;
  let nextId = 0;
  let options = { upload: null, onChange: null, onBatchDone: null };

  const snapshot = () => items.map((item) => ({ ...item }));
  const emit = () => options.onChange?.(snapshot());
  const pending = (item) => item.status === "pending";

  function finish() {
    const count = uploaded;
    batchOpen = false; uploaded = 0;
    options.onBatchDone?.(count);
  }

  function pump() {
    while (active < concurrency) {
      const next = items.find(pending);
      if (!next || !options.upload) break;
      next.status = "uploading"; next.error = "";
      active += 1; batchOpen = true;
      Promise.resolve()
        .then(() => options.upload(next.file))
        .then((response) => {
          const duplicate = Boolean(response?.data?.duplicate);
          next.status = duplicate ? "duplicate" : "uploaded";
          if (!duplicate) uploaded += 1;
        })
        .catch((cause) => { next.status = "failed"; next.error = cause?.message || "Upload failed."; })
        .finally(() => { active -= 1; emit(); pump(); });
    }
    emit();
    if (active === 0 && batchOpen) finish();
  }

  return {
    configure(next) { options = { ...options, ...next }; },
    /** `accept(file)` says whether a file is worth sending; the rest are listed as skipped. */
    add(files, accept = () => true) {
      const additions = Array.from(files || []).map((file) => {
        const ok = accept(file);
        return { id: ++nextId, file, name: file.name, size: file.size, status: ok ? "pending" : "skipped", error: ok ? "" : "Not a photo or video." };
      });
      if (!additions.length) return;
      items = [...items, ...additions];
      pump();
    },
    retryFailed() { for (const item of items) if (item.status === "failed") item.status = "pending"; pump(); },
    clearFinished() { items = items.filter((item) => pending(item) || item.status === "uploading"); emit(); },
    /** Nothing more starts. What is already on the wire finishes and the batch is reported. */
    cancelPending() { for (const item of items) if (pending(item)) item.status = "skipped"; emit(); },
    get running() { return active > 0 || items.some(pending); },
    snapshot,
  };
}
