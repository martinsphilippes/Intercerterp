/**
 * Gera uma credencial do Interos: imprime o TOKEN (entregue uma única vez ao Interos, por canal seguro) e a linha para
 * `INTEROS_CLIENTS` com o SHA-256 (o ERP nunca guarda o token).
 *   npx tsx scripts/modules/new-interos-token.ts interos-prod erp.modules.read,erp.modules.write
 */
import crypto from "node:crypto";

const id = process.argv[2] ?? "interos";
const scopes = (process.argv[3] ?? "erp.modules.read,erp.modules.write").split(",");
const token = crypto.randomBytes(32).toString("base64url");
const tokenSha256 = crypto.createHash("sha256").update(token).digest("hex");
console.log("Token (entregue ao Interos; não fica salvo):", token);
console.log("Entrada de INTEROS_CLIENTS:", JSON.stringify({ id, tokenSha256, scopes }));
