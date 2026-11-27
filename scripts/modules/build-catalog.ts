/**
 * Gera docs/modulos/catalogo-modulos-erp-v1.json a partir de src/lib/modules/catalog.ts (fonte única).
 *   npm run modules:catalog            (grava)
 *   npm run modules:catalog -- --check (falha se o arquivo estiver desatualizado)
 */
import fs from "node:fs";
import path from "node:path";
import { catalogDocument } from "../../src/lib/modules/export";

const file = path.join(__dirname, "../../docs/modulos/catalogo-modulos-erp-v1.json");
const doc = catalogDocument();
if (!doc.validation.valid) {
  console.error("Catálogo inválido:", doc.validation.issues);
  process.exit(1);
}
const text = JSON.stringify(doc, null, 2) + "\n";
if (process.argv.includes("--check")) {
  const cur = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (cur !== text) {
    console.error("docs/modulos/catalogo-modulos-erp-v1.json desatualizado: rode npm run modules:catalog");
    process.exit(1);
  }
  console.log("catálogo em dia");
} else {
  fs.writeFileSync(file, text);
  console.log(`gravado ${path.relative(process.cwd(), file)} (${doc.modules.length} entradas)`);
}
