import "./env";
import { appwriteConfig } from "../src/lib/db";
import { provisionAppwrite } from "../src/lib/db/provision";

const cfg = appwriteConfig();
if (!cfg.endpoint || !cfg.projectId || !cfg.apiKey) {
  console.error("Defina APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID e APPWRITE_API_KEY (.env.local).");
  process.exit(1);
}
provisionAppwrite(cfg).catch((e) => {
  console.error(e);
  process.exit(1);
});
