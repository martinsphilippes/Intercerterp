import type { DemoRefs } from "../base";
import { ensureHelpArticles } from "../../help-content";
import { createTicket, replyTicket } from "../../support";
import { createUser } from "../../users";
import { createBackup } from "../../backup";
import { syncSystemRoles } from "@/lib/auth/role-sync";

/**
 * Cenários de demonstração do módulo (admin/suporte). Idempotente (chaves determinísticas):
 *  - artigos de ajuda (conteúdo do produto, globais);
 *  - 2 chamados (um respondido pelo suporte, aguardando o usuário; outro aberto);
 *  - 1 usuário com convite pendente (link exibido só na criação/reenvio);
 *  - 1 cópia de segurança verificada em base de teste isolada.
 */
export async function seed(refs: DemoRefs): Promise<unknown> {
  const store = refs.seeder.store;
  // perfis de sistema recebem as operações novas dos modelos padrão (repetível; nada configurado é removido)
  await syncSystemRoles(store, refs.company.id);
  const help = await ensureHelpArticles(store);
  const admin = await refs.ctxFor("admin", "matriz");
  const cashier = await refs.ctxFor("cashier", "matriz");
  const stockist = await refs.ctxFor("stockist", "shopping");

  const t1 = await createTicket(cashier, {
    category: "pdv",
    priority: "high",
    subject: "Cupom saindo cortado na impressora do Caixa 02",
    message: "Desde ontem o cupom da venda sai com a lateral direita cortada no Caixa 02 da Matriz. Os valores ficam ilegíveis. Já reiniciei o computador.",
    context: { route: "/pdv", branchId: refs.branches.matriz.id, branchName: refs.branches.matriz.name, userAgent: "Demonstração" },
    idemKey: "demo-ticket-1",
  });
  await replyTicket(admin, t1.id, {
    body: "Olá, Carla. O terminal CX02 está configurado para papel de 80 mm. Confirme se a bobina instalada é de 58 mm; se for, ajuste em Administração → Terminais → Caixa 02 → Periféricos e use “Prévia de impressão” para conferir.",
    idemKey: "demo-ticket-1-reply",
  });
  const t2 = await createTicket(stockist, {
    category: "estoque",
    priority: "normal",
    subject: "Como registrar avaria encontrada no recebimento?",
    message: "Recebemos 2 canecas quebradas na última entrega. Devo lançar ajuste ou transferir para o depósito de avarias?",
    context: { route: "/estoque/movimentos", branchId: refs.branches.shopping.id, branchName: refs.branches.shopping.name, userAgent: "Demonstração" },
    idemKey: "demo-ticket-2",
  });

  const roleId = (await store.list("roles", { filters: [["eq", "companyId", refs.company.id], ["eq", "key", "finance"]], limit: 1 })).items[0]?.id ?? null;
  const invited = await createUser(admin, {
    name: "Paula Prado (convite)",
    email: "convite.pendente@demo.intercert.local",
    login: "paula.prado",
    roleId,
    companyIds: [refs.company.id],
    branchIds: [refs.branches.matriz.id],
    mode: "invite",
    origin: process.env.APP_URL ?? "http://localhost:3000",
    idemKey: "demo-invite",
  });

  const backup = await createBackup(admin, { kind: "manual", includeFiles: true, includeGlobal: true, verify: true, idemKey: "demo-backup" });

  return { help, tickets: [t1.number, t2.number], invitedUser: invited.user.id, backup: { id: backup.id, status: backup.status } };
}
