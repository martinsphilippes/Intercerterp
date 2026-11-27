/** Linha de base de todas as empresas sem estado de módulos (modo legacy; idempotente). npm run modules:baseline */
import "../env";
import { getStore } from "../../src/lib/db";
import { MemoryStore } from "../../src/lib/db/memory-store";
import { baselineAllCompanies } from "../../src/domain/modules/baseline";

(async () => {
  const store = getStore();
  console.log(JSON.stringify(await baselineAllCompanies(store), null, 2));
  if (store instanceof MemoryStore) store.flush();
})();
