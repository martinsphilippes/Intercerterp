import { listAll } from "@/lib/db";
import { notify } from "@/lib/core/notify";
import { addDays, today } from "@/lib/dates";
import { registerRoutine } from "../scheduler";
import { transferCode } from "../transfers";

/**
 * Rotinas diárias do estoque:
 *  - transferências em trânsito atrasadas (previsão vencida ou expedidas há mais de 3 dias sem previsão);
 *  - inventários abertos há mais de 7 dias (a base fica cada vez mais distante da contagem).
 * As notificações são deduplicadas por ocorrência (uma por transferência/inventário).
 */
registerRoutine("stock.transfers_overdue", async (store, companyId) => {
  const d = today();
  const list = await listAll(store, "transfers", { filters: [["eq", "companyId", companyId], ["eq", "status", ["in_transit", "partial"]]] });
  let n = 0;
  for (const t of list) {
    const late = t.expectedAt ? t.expectedAt < d : t.shippedAt && String(t.shippedAt).slice(0, 10) < addDays(d, -3);
    if (!late) continue;
    await notify(store, {
      companyId,
      branchId: t.toBranchId,
      type: "deadline",
      priority: "high",
      title: `Transferência ${transferCode(t.number)} atrasada`,
      body: t.expectedAt ? `Previsão de chegada ${t.expectedAt.split("-").reverse().join("/")} vencida; saldo ainda em trânsito.` : "Expedida há mais de 3 dias e ainda em trânsito.",
      link: `/estoque/transferencias/${t.id}`,
      originType: "transfer",
      originId: t.id,
      occurrenceKey: `transfer_overdue:${t.id}`,
      audience: { module: "stock" },
    });
    n++;
  }
  return { overdue: n };
});

registerRoutine("stock.inventories_stale", async (store, companyId) => {
  const limit = addDays(today(), -7);
  const list = await listAll(store, "inventories", { filters: [["eq", "companyId", companyId], ["eq", "status", ["open", "counting"]]] });
  let n = 0;
  for (const inv of list) {
    if (String(inv.baseAt).slice(0, 10) > limit) continue;
    await notify(store, {
      companyId,
      branchId: inv.branchId,
      type: "info",
      title: `Inventário ${inv.code ?? inv.number} aberto há mais de 7 dias`,
      body: "Conclua ou cancele o inventário; a base de comparação fica distante das contagens.",
      link: `/estoque/inventarios/${inv.id}`,
      originType: "inventory",
      originId: inv.id,
      occurrenceKey: `inventory_stale:${inv.id}`,
      audience: { module: "stock" },
    });
    n++;
  }
  return { stale: n };
});
