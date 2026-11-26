import { detId, findOne, isConflict, listAll } from "@/lib/db";
import type { Store } from "@/lib/db/types";
import { COLLECTIONS } from "@/lib/db/schema";
import { unscoped, SHARED_GLOBAL } from "@/lib/db/scoped-store";
import { PLATFORM_ACTIONS } from "@/lib/permissions";
import { nowIso } from "@/lib/dates";
import { materializeRelations, type MaterializeReport } from "./relations";

/**
 * Migração multiempresa (docs/multiempresa/migracao.md) — aditiva, verificável e repetível:
 *  1. retrato ANTES: registros por coleção e empresa e os valores de conferência (vendas, títulos, estoque, fiscal);
 *  2. conferências: registro sem empresa, filial de outra empresa, usuário com empresa ou filial inexistente,
 *     credencial compartilhada entre empresas, perfil de cliente com operação da plataforma;
 *     o que for inequívoco é preenchido (no modo "aplicar"); o ambíguo vai para a fila de revisão (`tenancy_reviews`);
 *  3. empresa da plataforma e vínculos explícitos entre empresas (escritório, rede);
 *  4. retrato DEPOIS e comparação: a migração nunca altera valores de negócio — qualquer diferença reprova a execução.
 * "simular" não grava nada além do próprio relatório.
 */

export type MigrationMode = "simular" | "aplicar";

interface Snapshot {
  collections: Record<string, number>;
  byCompany: Record<string, { registros: number; vendas: number; vendasCentavos: number; titulosAbertosCentavos: number; estoqueMilesimos: number; documentosFiscais: number }>;
}

const SKIP = new Set(["sessions", "auth_challenges", "tenancy_violations", "migration_runs", "tenancy_reviews", "service_requests"]);

async function snapshot(store: Store): Promise<Snapshot> {
  const base = unscoped(store);
  const out: Snapshot = { collections: {}, byCompany: {} };
  const bucket = (c: string) => (out.byCompany[c] ??= { registros: 0, vendas: 0, vendasCentavos: 0, titulosAbertosCentavos: 0, estoqueMilesimos: 0, documentosFiscais: 0 });
  for (const def of COLLECTIONS) {
    if (SKIP.has(def.id)) continue;
    const rows = await listAll(base, def.id);
    out.collections[def.id] = rows.length;
    if (!def.fields.companyId) continue;
    for (const r of rows) {
      const c = String(r.companyId ?? "(sem empresa)");
      const b = bucket(c);
      b.registros++;
      if (def.id === "sales" && r.status !== "cancelled") {
        b.vendas++;
        b.vendasCentavos += Number(r.total ?? 0);
      }
      if (def.id === "titles" && r.status !== "cancelled" && r.status !== "settled") b.titulosAbertosCentavos += Number(r.openAmount ?? r.amount ?? 0);
      if (def.id === "stock_balances") b.estoqueMilesimos += Number(r.physical ?? 0);
      if (def.id === "fiscal_documents") b.documentosFiscais++;
    }
  }
  return out;
}

function diffSnapshots(a: Snapshot, b: Snapshot): string[] {
  const out: string[] = [];
  for (const k of new Set([...Object.keys(a.byCompany), ...Object.keys(b.byCompany)])) {
    const x = a.byCompany[k];
    const y = b.byCompany[k];
    for (const f of ["vendas", "vendasCentavos", "titulosAbertosCentavos", "estoqueMilesimos", "documentosFiscais"] as const) {
      if ((x?.[f] ?? 0) !== (y?.[f] ?? 0)) out.push(`${k}: ${f} ${x?.[f] ?? 0} → ${y?.[f] ?? 0}`);
    }
  }
  return out;
}

async function review(store: Store, apply: boolean, runId: string, item: { collection: string; recordId: string; reason: string; candidates?: string[] }) {
  if (!apply) return;
  const base = unscoped(store);
  const id = detId("treview", item.collection, item.recordId);
  if (await base.get("tenancy_reviews", id)) return;
  try {
    await base.create("tenancy_reviews", { collection: item.collection, recordId: item.recordId, reason: item.reason, candidates: item.candidates ?? [], status: "pendente", runId, detectedAt: nowIso() }, id);
  } catch (e) {
    if (!isConflict(e)) throw e;
  }
}

export interface MigrationReport {
  runId: string;
  mode: MigrationMode;
  startedAt: string;
  finishedAt: string;
  isolamento: string;
  antes: Snapshot;
  depois: Snapshot;
  conferencia: { ok: boolean; diferencas: string[] };
  preenchidos: Array<{ collection: string; recordId: string; companyId: string; motivo: string }>;
  revisao: Array<{ collection: string; recordId: string; motivo: string }>;
  plataforma: { empresa: string | null; marcadaAgora: boolean; observacao: string | null };
  equipeDemonstracao: { movida: boolean; observacao: string | null };
  perfisComOperacaoDePlataforma: Array<{ roleId: string; companyId: string; actions: string[] }>;
  credenciaisCompartilhadas: Array<{ variavel: string; empresas: number }>;
  vinculos: MaterializeReport;
}

export async function runTenancyMigration(store: Store, opts: { mode: MigrationMode; requestedBy: string }): Promise<MigrationReport> {
  const base = unscoped(store);
  const apply = opts.mode === "aplicar";
  const startedAt = nowIso();
  const runId = detId("tmig", startedAt, opts.mode);
  const antes = await snapshot(base);
  const preenchidos: MigrationReport["preenchidos"] = [];
  const revisao: MigrationReport["revisao"] = [];
  const companies = await listAll(base, "companies");
  const companyIds = new Set(companies.map((c) => c.id));
  const branches = await listAll(base, "branches");
  const branchCompany = new Map(branches.map((b) => [b.id, b.companyId as string]));

  // 1) registros sem empresa e filial de outra empresa
  for (const def of COLLECTIONS) {
    if (!def.fields.companyId || SKIP.has(def.id) || SHARED_GLOBAL.has(def.id)) continue;
    const optional = !def.fields.companyId.required;
    const rows = await listAll(base, def.id);
    for (const r of rows) {
      const c = r.companyId;
      const fromBranch = r.branchId ? branchCompany.get(r.branchId) : undefined;
      if (c == null || c === "") {
        if (optional) continue; // coleções com empresa opcional (globais legítimos): nada a preencher
        if (fromBranch) {
          preenchidos.push({ collection: def.id, recordId: r.id, companyId: fromBranch, motivo: "empresa derivada da filial do registro" });
          if (apply) await base.update(def.id, r.id, { companyId: fromBranch });
        } else {
          revisao.push({ collection: def.id, recordId: r.id, motivo: "registro sem empresa e sem filial que a identifique" });
          await review(base, apply, runId, { collection: def.id, recordId: r.id, reason: "registro sem empresa e sem filial que a identifique" });
        }
        continue;
      }
      if (c !== "platform" && c !== "public" && !companyIds.has(c)) {
        revisao.push({ collection: def.id, recordId: r.id, motivo: `empresa ${c} inexistente` });
        await review(base, apply, runId, { collection: def.id, recordId: r.id, reason: `empresa ${c} inexistente`, candidates: fromBranch ? [fromBranch] : [] });
        continue;
      }
      if (fromBranch && fromBranch !== c && def.id !== "branches") {
        revisao.push({ collection: def.id, recordId: r.id, motivo: `filial ${r.branchId} pertence a outra empresa` });
        await review(base, apply, runId, { collection: def.id, recordId: r.id, reason: `filial ${r.branchId} pertence a outra empresa (${fromBranch}) — empresa ambígua`, candidates: [c, fromBranch] });
      }
    }
  }

  // 2) usuários com vínculos inconsistentes
  for (const u of await listAll(base, "users")) {
    const bad = (u.companyIds ?? []).filter((c: string) => !companyIds.has(c));
    if (bad.length) {
      revisao.push({ collection: "users", recordId: u.id, motivo: `vínculo com empresa inexistente (${bad.join(", ")})` });
      await review(base, apply, runId, { collection: "users", recordId: u.id, reason: `vínculo com empresa inexistente (${bad.join(", ")})` });
    }
    const strayBranches = (u.branchIds ?? []).filter((b: string) => !branchCompany.has(b) || !(u.companyIds ?? []).includes(branchCompany.get(b)));
    if (strayBranches.length && !u.isAdmin) {
      revisao.push({ collection: "users", recordId: u.id, motivo: `filial fora das empresas do usuário (${strayBranches.join(", ")})` });
      await review(base, apply, runId, { collection: "users", recordId: u.id, reason: `filial fora das empresas do usuário (${strayBranches.join(", ")})` });
    }
  }

  // 3) empresa da plataforma (operações da rede inteira e da equipe de certificação só valem nela)
  const plataforma: MigrationReport["plataforma"] = { empresa: null, marcadaAgora: false, observacao: null };
  let platform = companies.find((c) => c.isPlatform) ?? null;
  const roles = await listAll(base, "roles");
  if (!platform) {
    const holders = new Set<string>();
    for (const r of roles) if ((r.actions ?? []).includes("network.manage") && r.companyId) holders.add(r.companyId);
    const candidates = [...holders].filter((c) => companies.find((x) => x.id === c)?.kind === "certification");
    if (candidates.length === 1) {
      platform = companies.find((c) => c.id === candidates[0])!;
      plataforma.marcadaAgora = apply;
      plataforma.observacao = "única empresa de parceiro da rede com perfil de gestão da rede inteira";
      if (apply) platform = await base.update("companies", platform.id, { isPlatform: true });
    } else if (candidates.length > 1) {
      plataforma.observacao = `mais de uma candidata (${candidates.join(", ")}): defina manualmente (companies.isPlatform)`;
      for (const c of candidates) await review(base, apply, runId, { collection: "companies", recordId: c, reason: "candidata a empresa da plataforma (mais de uma)" });
    } else plataforma.observacao = "nenhuma empresa com gestão da rede: sem empresa da plataforma (operações de plataforma ficam sem efeito)";
  }
  plataforma.empresa = platform?.id ?? null;

  // 4) perfis de cliente com operação da plataforma (ficam sem efeito; listados para limpeza)
  const perfisComOperacaoDePlataforma = roles
    .filter((r) => r.companyId && r.companyId !== platform?.id && (r.actions ?? []).some((a: string) => (PLATFORM_ACTIONS as string[]).includes(a)))
    .map((r) => ({ roleId: r.id, companyId: r.companyId, actions: (r.actions ?? []).filter((a: string) => (PLATFORM_ACTIONS as string[]).includes(a)) }));

  // 5) demonstração: equipe de certificação passa a trabalhar na empresa da plataforma
  const equipeDemonstracao: MigrationReport["equipeDemonstracao"] = { movida: false, observacao: null };
  const team = await findOne(base, "users", [["eq", "login", "certificacao"]]);
  if (team?.isDemo && platform && !(team.companyIds ?? []).includes(platform.id)) {
    const teamRole = roles.find((r) => r.companyId === platform!.id && r.name === "Equipe de certificação (DEMO)");
    equipeDemonstracao.observacao = teamRole ? "usuário de demonstração movido para a empresa da plataforma" : "perfil da equipe na plataforma ainda não existe (rode a demonstração atualizada)";
    if (apply && teamRole) {
      await base.update("users", team.id, { companyIds: [platform.id], roleId: teamRole.id, roleByCompany: { [platform.id]: teamRole.id }, branchIds: [] });
      equipeDemonstracao.movida = true;
    } else if (apply && !teamRole) {
      const { createRole } = await import("../roles");
      const { scopeStore } = await import("@/lib/db/scoped-store");
      const sys = { store: scopeStore(base, platform.id, { platform: true }), companyId: platform.id, branchId: null, user: { id: "system", name: "Migração multiempresa", email: "", isAdmin: true, permissions: {}, actions: [], discountLimitBps: 0, branchIds: [], companyIds: [platform.id] } };
      const role = await createRole(sys, { name: "Equipe de certificação (DEMO)", description: "Confirma pagamentos, valida titulares e registra emissões de certificados digitais (plataforma Intercert).", permissions: { dashboard: { view: true }, admin: { view: true }, support: { view: true, create: true, edit: true } } as any, actions: ["certification.operate"], discountLimitBps: 0 });
      await base.update("users", team.id, { companyIds: [platform.id], roleId: role.id, roleByCompany: { [platform.id]: role.id }, branchIds: [] });
      equipeDemonstracao.movida = true;
      equipeDemonstracao.observacao = "perfil da equipe criado na empresa da plataforma e usuário de demonstração movido";
    }
  }

  // 6) credenciais compartilhadas entre empresas (variável de ambiente com mais de um dono)
  const owners = new Map<string, Set<string>>();
  for (const i of await listAll(base, "integrations")) for (const ref of Object.values(i.secretRefs ?? {}) as string[]) if (ref) (owners.get(ref) ?? owners.set(ref, new Set()).get(ref)!).add(i.companyId);
  const credenciaisCompartilhadas = [...owners].filter(([, s]) => s.size > 1).map(([variavel, s]) => ({ variavel, empresas: s.size }));
  for (const c of credenciaisCompartilhadas) await review(base, apply, runId, { collection: "integrations", recordId: detId("ref", c.variavel), reason: `variável ${c.variavel} usada como credencial por ${c.empresas} empresas` });

  // 7) vínculos explícitos entre empresas
  const vinculos = await materializeRelations(base, { apply, actor: { id: "system", name: `Migração multiempresa (${opts.requestedBy})` } });

  const depois = await snapshot(base);
  const diferencas = diffSnapshots(antes, depois);
  const { isolationMode } = await import("@/lib/db/scoped-store");
  const report: MigrationReport = {
    runId, mode: opts.mode, startedAt, finishedAt: nowIso(), isolamento: isolationMode(), antes, depois, conferencia: { ok: diferencas.length === 0, diferencas },
    preenchidos, revisao, plataforma, equipeDemonstracao, perfisComOperacaoDePlataforma, credenciaisCompartilhadas, vinculos,
  };
  await base.create("migration_runs", { kind: "multiempresa", mode: opts.mode, status: report.conferencia.ok ? "ok" : "divergente", startedAt, finishedAt: report.finishedAt, report, requestedBy: opts.requestedBy }, runId).catch(() => undefined);
  return report;
}
