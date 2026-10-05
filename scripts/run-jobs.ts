import "./env";
import { getStore } from "../src/lib/db";
import { runDueJobs } from "../src/domain/jobs-registry";
import { runScheduled } from "../src/domain/scheduler";
import { MemoryStore } from "../src/lib/db/memory-store";

(async () => {
  const store = getStore();
  console.log(JSON.stringify({ scheduled: await runScheduled(store), jobs: await runDueJobs(store, { limit: 200 }) }, null, 2));
  if (store instanceof MemoryStore) store.flush();
})();
