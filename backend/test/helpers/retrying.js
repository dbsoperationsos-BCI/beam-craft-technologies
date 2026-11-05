/*
 * One write, tried again if InnoDB picks it as a deadlock victim (P2034). The suite runs its files
 * side by side against one database, so a file's fixture inserts meet other files' writes on the
 * same tables - sales_project, user, role, image_selection_project - and MySQL may abort either; the
 * one aborted is told to retry, which is what a deadlock is. The app's own writes that meet this do
 * the same - see `image-selection/processing/repository.js`. Each write is retried on its own, never
 * a setup as a whole, so nothing is created twice.
 */
async function retrying(write, attempts = 5) {
  for (let attempt = 1; ; attempt += 1) {
    try { return await write(); } catch (error) {
      if (error?.code !== "P2034" || attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 * attempt));
    }
  }
}

module.exports = { retrying };
