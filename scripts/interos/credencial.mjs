#!/usr/bin/env node
// Gera uma credencial do Interos para o ERP — registro ÚNICO das três APIs (docs/interos/credenciais.md).
// Uso: node scripts/interos/credencial.mjs <id> <escopo> [escopo...] [--empresas=<id>,<id>] [--assinatura=<VARIAVEL>]
//   provisionamento: node scripts/interos/credencial.mjs interos-prov-hml provisionamento:leitura provisionamento:escrita
//   Torre:           node scripts/interos/credencial.mjs interos-torre-hml torre:resumo torre:detalhe torre:transacoes
//   licenças:        node scripts/interos/credencial.mjs interos-licencas-hml erp.license.read erp.license.write erp.modules.read erp.usage.read \
//                      --empresas=<id ERP da empresa 1>,<id 2> --assinatura=INTEROS_ASSINATURA_HML
// Mostra o TOKEN uma única vez e a entrada para INTEROS_CREDENCIAIS (só o hash). Com --assinatura, gera também o
// segredo HMAC (o MESMO valor vai na variável indicada, no ERP, e em ERP_INTERCERT_SEGREDO_ASSINATURA, no Interos).
// O token e o segredo vão direto para as variáveis da Vercel de cada lado; nunca por chat, e-mail ou documento.
import crypto from "node:crypto";

const FAMILIAS = {
  provisionamento: ["provisionamento:leitura", "provisionamento:escrita"],
  torre: ["torre:resumo", "torre:detalhe", "torre:transacoes"],
  licencas: ["erp.license.read", "erp.license.write", "erp.modules.read", "erp.modules.write", "erp.usage.read"],
};
const ESCOPOS = Object.values(FAMILIAS).flat();
const args = process.argv.slice(2);
const flags = Object.fromEntries(args.filter((a) => a.startsWith("--")).map((a) => a.slice(2).split("=")));
const [id, ...escopos] = args.filter((a) => !a.startsWith("--"));
const uso = `Uso: node scripts/interos/credencial.mjs <id> <escopo...> [--empresas=a,b] [--assinatura=VARIAVEL]\nEscopos: ${ESCOPOS.join(", ")}`;
if (!id || !/^[a-z0-9][a-z0-9._-]{2,63}$/i.test(id) || !escopos.length || escopos.some((e) => !ESCOPOS.includes(e))) {
  console.error(uso);
  process.exit(1);
}
const familias = new Set(escopos.map((e) => Object.keys(FAMILIAS).find((f) => FAMILIAS[f].includes(e))));
if (familias.size !== 1) {
  console.error("Escopos separados: provisionamento, Torre de Controle e licenças usam credenciais (ids) diferentes.");
  process.exit(1);
}
const empresas = flags.empresas ? flags.empresas.split(",").map((s) => s.trim()).filter(Boolean) : null;
if (empresas && empresas.some((c) => !/^[A-Za-z0-9_-]{1,64}$/.test(c))) {
  console.error("--empresas: identificadores ERP separados por vírgula.");
  process.exit(1);
}
const assinatura = flags.assinatura ?? null;
if (assinatura && !/^[A-Z][A-Z0-9_]{2,80}$/.test(assinatura)) {
  console.error("--assinatura: nome de variável em MAIÚSCULAS (ex.: INTEROS_ASSINATURA_HML).");
  process.exit(1);
}
if (familias.has("licencas") && escopos.some((e) => e.endsWith(".write")) && !assinatura) {
  console.error("Credencial de licenças com escrita exige --assinatura (as gravações de licença são sempre assinadas).");
  process.exit(1);
}
const segredo = crypto.randomBytes(32).toString("base64url");
const hash = crypto.createHash("sha256").update(segredo, "utf8").digest("hex");
console.log("TOKEN (vai para o Interos; não fica guardado no ERP):");
console.log(`  ${id}.${segredo}\n`);
if (assinatura) {
  console.log(`SEGREDO DE ASSINATURA (o mesmo valor na variável ${assinatura} do ERP e em ERP_INTERCERT_SEGREDO_ASSINATURA do Interos):`);
  console.log(`  ${crypto.randomBytes(36).toString("base64url")}\n`);
}
console.log("Entrada para a variável INTEROS_CREDENCIAIS do ERP (lista JSON):");
console.log("  " + JSON.stringify({ id, nome: id, escopos, hash: `sha256:${hash}`, ...(empresas ? { empresas } : {}), ...(assinatura ? { assinatura } : {}) }));
