/**
 * The published desktop installer lives on its own host, not behind this app's API, so this is a
 * plain `fetch` rather than `apiRequest`: no base URL, no JWT, nothing of the studio's sent along.
 */

/*
 * Asks the host whether the installer is there before handing the address to the browser, so a
 * removed file reads as a message in the dialog rather than as an error page. Resolves to the HTTP
 * status when the host answers that it is missing, else `null`. A host that does not answer
 * cross-origin requests cannot be asked, and is trusted: the browser's own download bar reports it.
 */
export async function findMissingInstallerStatus(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, { method: "HEAD", signal: controller.signal, cache: "no-store" });
    return response.ok ? null : response.status;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
