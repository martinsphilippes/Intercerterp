import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { MODULES_CATALOG, MODULE_MAP, CONTRACTABLE } from "@/lib/modules/catalog";
import { validateCatalog, transitiveRequires, dependentsOf, missingDependencies, directEdges } from "@/lib/modules/graph";
import { declaredSurfaces, modulesForPath, modulesForExport, modulesForFeature } from "@/lib/modules/surfaces";
import { catalogDocument } from "@/lib/modules/export";
import { SPECIAL_ACTIONS } from "@/lib/permissions";
import { BLOCKERS } from "@/domain/modules/blockers";
import { USAGE_EVIDENCE } from "@/domain/modules/baseline";
import { COLLECTION_MAP } from "@/lib/db/schema";
import type { ModuleDef } from "@/lib/modules/types";

/**
 * Catálogo de módulos (catalogo-modulos-erp-v1): grafo válido e rastreabilidade COMPLETA superfície → módulo.
 * Estes testes falham quando alguém cria tela, ação, exportação, rotina ou recurso novo sem dizer qual módulo o governa.
 */

const ROOT = path.resolve(__dirname, "..");
const APP = path.join(ROOT, "src/app");

function walk(dir: string, name: (f: string) => boolean, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, name, out);
    else if (name(e.name)) out.push(p);
  }
  return out;
}
const routeOf = (file: string) => "/" + path.relative(APP, path.dirname(file)).split(path.sep).filter((s) => !/^\(.+\)$/.test(s)).join("/");

describe("catálogo — grafo e definição", () => {
  it("é válido: sem chave repetida, referência inexistente, ciclo ou dependência de componente técnico como comercial", () => {
    expect(validateCatalog(MODULES_CATALOG)).toEqual([]);
  });

  it("detecta ciclos e referências inválidas (validador)", () => {
    const base = (key: string, extra: Partial<ModuleDef> = {}): ModuleDef => ({ key, name: key, description: "", family: "x", version: "1", classification: "commercial", availability: "available", kinds: ["retail"], surfaces: {}, deactivation: { mode: "immediate", afterOff: "read_history" }, existing: "exists", ...extra });
    const issues = validateCatalog([base("a", { requires: ["b"] }), base("b", { requires: ["c"] }), base("c", { requires: ["a"] }), base("d", { requires: ["zzz"] })]);
    expect(issues.some((i) => i.kind === "cycle")).toBe(true);
    expect(issues.some((i) => i.kind === "unknown_ref" && i.module === "d")).toBe(true);
  });

  it("chaves estáveis no formato familia.nome e toda entrada tem descrição, versão e política de desligamento", () => {
    for (const m of MODULES_CATALOG) {
      expect(m.key, m.key).toMatch(/^[a-z]+\.[a-z_]+$/);
      expect(m.description.length, m.key).toBeGreaterThan(10);
      expect(m.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(["immediate", "drain", "scheduled"]).toContain(m.deactivation.mode);
    }
  });

  it("dependências diretas e transitivas (amostras do levantamento)", () => {
    expect(MODULE_MAP.get("compras.cotacoes")!.requires).toContain("compras.pedidos");
    expect(transitiveRequires(MODULES_CATALOG, "clientes.fidelidade")).toEqual(expect.arrayContaining(["cadastros.clientes", "vendas.pdv", "caixa.operacao", "cadastros.produtos"]));
    expect(transitiveRequires(MODULES_CATALOG, "ecommerce.loja")).toEqual(expect.arrayContaining(["fiscal.nfe", "cadastros.produtos"]));
    expect(transitiveRequires(MODULES_CATALOG, "ecommerce.loja")).not.toContain("vendas.pdv");
    expect(dependentsOf(MODULES_CATALOG, "caixa.operacao")).toEqual(expect.arrayContaining(["vendas.pdv", "vendas.devolucoes", "pdv.recebimento_crediario"]));
  });

  it("combinações reais do levantamento são consistentes (sem dependência acidental)", () => {
    const ok = (keys: string[]) => missingDependencies(MODULES_CATALOG, new Set(keys));
    // PDV com NFC-e e sem loja virtual
    expect(ok(["vendas.pdv", "caixa.operacao", "cadastros.produtos", "fiscal.nfce"])).toEqual([]);
    // compras sem cotações
    expect(ok(["compras.pedidos", "compras.recebimento", "cadastros.fornecedores", "cadastros.produtos"])).toEqual([]);
    // estoque sem lotes
    expect(ok(["estoque.gestao", "estoque.transferencias", "estoque.inventario", "cadastros.produtos"])).toEqual([]);
    // produtos sem edição em massa (e com precificação após a entrada, que não usa a edição em massa)
    expect(ok(["cadastros.produtos", "compras.recebimento", "compras.precificacao", "cadastros.fornecedores"])).toEqual([]);
    // loja virtual sem PDV (exige NF-e: a expedição só sai com a nota autorizada)
    expect(ok(["ecommerce.loja", "cadastros.produtos", "fiscal.nfe"])).toEqual([]);
    expect(ok(["ecommerce.loja", "cadastros.produtos"])[0].missing).toEqual(["fiscal.nfe"]);
    // financeiro sem conciliação
    expect(ok(["financeiro.contas_receber", "financeiro.contas_pagar", "financeiro.fluxo_caixa"])).toEqual([]);
    // fiscal sem SPED (SPED e Sintegra separados)
    expect(ok(["fiscal.nfe", "fiscal.nfce", "fiscal.sintegra", "fiscal.livro_entradas"])).toEqual([]);
    // bloqueios legítimos
    expect(ok(["compras.cotacoes"])[0].missing).toContain("compras.pedidos");
    expect(ok(["vendas.pdv", "cadastros.produtos"])[0].missing).toContain("caixa.operacao");
  });

  it("toda função opcional tem pai e nenhuma lacuna (planned) é contratável", () => {
    for (const m of MODULES_CATALOG.filter((x) => x.classification === "optional_function")) expect(m.parent, m.key).toBeTruthy();
    expect(CONTRACTABLE.some((m) => m.availability === "planned")).toBe(false);
    for (const m of MODULES_CATALOG) for (const e of directEdges(m)) expect(MODULE_MAP.has(e), `${m.key} → ${e}`).toBe(true);
  });

  it("o JSON entregue ao Interos está em dia com o catálogo do código", () => {
    const file = path.join(ROOT, "docs/modulos/catalogo-modulos-erp-v1.json");
    expect(fs.readFileSync(file, "utf8")).toBe(JSON.stringify(catalogDocument(), null, 2) + "\n");
  });
});

describe("rastreabilidade — superfície → módulo", () => {
  it("toda tela interna e pública tem módulo (ou é da plataforma)", () => {
    const pages = walk(APP, (f) => f === "page.tsx" || f === "route.ts").map(routeOf).filter((r) => !r.startsWith("/api/") && r !== "/");
    const unmapped = pages.filter((r) => !modulesForPath(r));
    expect(unmapped).toEqual([]);
  });

  it("toda rota de API tem módulo", () => {
    const apis = walk(path.join(APP, "api"), (f) => f === "route.ts").map(routeOf).filter((r) => !r.startsWith("/api/interos/"));
    expect(apis.filter((r) => !modulesForPath(r))).toEqual([]);
  });

  it("toda server action declara o módulo e a chave existe no catálogo; nomes da política de desligamento existem", () => {
    const files = walk(APP, (f) => f === "actions.ts");
    const declaredNames = new Set<string>();
    const missing: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(f, "utf8");
      for (const m of src.matchAll(/export async function ([A-Za-z0-9_]+)/g)) declaredNames.add(m[1]);
      for (const m of src.matchAll(/runAction\(([^)]{0,300})/g)) {
        if (!m[1].includes("entitlement:")) missing.push(`${path.relative(ROOT, f)}: ${m[1].slice(0, 60)}`);
        const keys = /entitlement: (\[[^\]]+\]|"[^"]+")/.exec(m[1])?.[1];
        for (const k of keys ? (JSON.parse(keys.replace(/^"(.*)"$/, '["$1"]')) as string[]) : []) expect(MODULE_MAP.has(k), `${f}: ${k}`).toBe(true);
      }
    }
    expect(missing).toEqual([]);
    for (const m of MODULES_CATALOG) for (const a of [...(m.deactivation.drainActions ?? []), ...(m.deactivation.historyActions ?? [])]) expect(declaredNames.has(a), `${m.key}: ${a}`).toBe(true);
  });

  it("toda exportação registrada tem módulo", async () => {
    const keys = walk(path.join(ROOT, "src/exports"), (f) => f.endsWith(".ts")).flatMap((f) => [...fs.readFileSync(f, "utf8").matchAll(/defineExport\("([^"]+)"/g)].map((m) => m[1]));
    expect(keys.length).toBeGreaterThan(40);
    expect(keys.filter((k) => !modulesForExport(k).length)).toEqual([]);
  });

  it("toda rotina diária e tarefa durável está declarada no catálogo", () => {
    const src = walk(path.join(ROOT, "src/domain"), (f) => f.endsWith(".ts")).map((f) => fs.readFileSync(f, "utf8")).join("\n");
    const routines = [...src.matchAll(/registerRoutine\("([^"]+)"/g)].map((m) => m[1]);
    const jobs = [...src.matchAll(/registerJob\("([^"]+)"/g)].map((m) => m[1]);
    const d = declaredSurfaces();
    expect(routines.filter((r) => !d.routines.has(r))).toEqual([]);
    expect(jobs.filter((j) => !d.jobs.has(j))).toEqual([]);
  });

  it("todo recurso feature.<chave> da interface tem módulo", () => {
    const src = fs.readFileSync(path.join(ROOT, "src/lib/server/features.ts"), "utf8");
    const keys = /export type FeatureKey = ([^;]+);/.exec(src)![1].match(/"([^"]+)"/g)!.map((s) => s.slice(1, -1));
    expect(keys.filter((k) => !modulesForFeature(k).length)).toEqual([]);
  });

  it("toda permissão de perfil é governada por um módulo (ou pela plataforma)", () => {
    const owned = new Set(MODULES_CATALOG.flatMap((m) => m.surfaces.permissions ?? []));
    expect(SPECIAL_ACTIONS.map((a) => a.key).filter((k) => !owned.has(k))).toEqual([]);
  });

  it("superfície compartilhada fica com mais de um dono; regra mais específica vence", () => {
    expect(modulesForPath("/fiscal/arquivos")!.modules).toEqual(["fiscal.sped"]);
    expect(modulesForPath("/fiscal/arquivos/sintegra")!.modules).toEqual(["fiscal.sintegra"]);
    expect(modulesForPath("/compras/recebimentos/abc/precificacao")!.modules).toEqual(["compras.precificacao"]);
    expect(modulesForPath("/compras/recebimentos/abc")!.modules).toEqual(["compras.recebimento"]);
    expect(modulesForPath("/rede/vendas")!.modules).toEqual(["rede.vendas"]);
    expect(modulesForPath("/rede/xyz")!.modules).toEqual(["rede.parceiro"]);
    expect(modulesForFeature("arquivosFiscais").sort()).toEqual(["fiscal.sintegra", "fiscal.sped"]);
  });

  it("verificações de pendência e evidências de uso apontam para tabelas e campos existentes", () => {
    for (const [k, b] of Object.entries(BLOCKERS)) for (const f of typeof b.filters === "function" ? b.filters() : b.filters) expect(COLLECTION_MAP[b.collection]?.fields[f[1] as string], `${k}.${String(f[1])}`).toBeTruthy();
    for (const [k, b] of Object.entries(USAGE_EVIDENCE)) for (const f of b.filters ?? []) expect(COLLECTION_MAP[b.collection]?.fields[f[1] as string], `${k}.${String(f[1])}`).toBeTruthy();
    for (const m of MODULES_CATALOG) for (const b of m.deactivation.blockers ?? []) expect(BLOCKERS[b], `${m.key}: ${b}`).toBeTruthy();
  });
});
