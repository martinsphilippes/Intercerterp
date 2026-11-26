#!/usr/bin/env node
// Gera uma credencial da interface de serviço (Interos → ERP).
// Uso: node scripts/interos/credencial.mjs <id> <escopo> [escopo...]
//   ex.: node scripts/interos/credencial.mjs interos-prov provisionamento:leitura provisionamento:escrita
//        node scripts/interos/credencial.mjs interos-torre torre:resumo torre:detalhe torre:transacoes
// Mostra o TOKEN uma única vez (entregue ao Interos por canal seguro) e a linha para INTEROS_CREDENCIAIS (só o hash).
import crypto from "node:crypto";

const ESCOPOS = ["provisionamento:leitura", "provisionamento:escrita", "torre:resumo", "torre:detalhe", "torre:transacoes"];
const [id, ...escopos] = process.argv.slice(2);
if (!id || !/^[a-z0-9][a-z0-9._-]{2,63}$/i.test(id) || !escopos.length || escopos.some((e) => !ESCOPOS.includes(e))) {
  console.error(`Uso: node scripts/interos/credencial.mjs <id> <escopo...>\nEscopos: ${ESCOPOS.join(", ")}`);
  process.exit(1);
}
if (escopos.some((e) => e.startsWith("provisionamento")) && escopos.some((e) => e.startsWith("torre"))) {
  console.error("Separe as credenciais: provisionamento e Torre de Controle usam ids diferentes (contrato §3).");
  process.exit(1);
}
const segredo = crypto.randomBytes(32).toString("base64url");
const hash = crypto.createHash("sha256").update(segredo, "utf8").digest("hex");
console.log("TOKEN (entregue ao Interos; não fica guardado no ERP):");
console.log(`  ${id}.${segredo}\n`);
console.log("Entrada para a variável INTEROS_CREDENCIAIS (lista JSON):");
console.log("  " + JSON.stringify({ id, nome: id, escopos, hash: `sha256:${hash}` }));
