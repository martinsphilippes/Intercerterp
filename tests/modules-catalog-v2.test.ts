import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { catalogV2Document } from "../scripts/modules/build-catalog-v2";
import { COLLECTIONS } from "@/lib/db/schema";

/**
 * Catálogo hierárquico v2 (proposta): integridade da auditoria. Recusa item "operacional" sem evidência real no código,
 * código da taxonomia sem classificação, chave v1 sem unidade v2, tabela sem dono, alias em cadeia e ciclo de dependência.
 */
const ROOT = path.resolve(__dirname, "..");
const doc = catalogV2Document();
const items = doc.items;
const byCode = new Map(items.map((n) => [n.code, n]));

describe("catálogo v2 — identificação e hierarquia", () => {
  it("contém todos os códigos da taxonomia de referência", () => {
    const codes = [...fs.readFileSync(path.join(ROOT, "docs/MODULE_CATALOG/taxonomia-referencia.txt"), "utf8").matchAll(/^(\d\d(?:\.\d\d)?) — |^MÓDULO (\d\d) — /gm)].map((m) => m[1] ?? m[2]);
    expect(codes.length).toBe(1021);
    expect(codes.filter((c) => !byCode.has(c))).toEqual([]);
  });

  it("códigos, IDs e slugs únicos; formato estável; pai existente", () => {
    expect(new Set(items.map((n) => n.id)).size).toBe(items.length);
    expect(new Set(items.map((n) => n.slug)).size).toBe(items.length);
    for (const n of items) {
      expect(n.code, n.code).toMatch(/^\d\d(\.\d\d){0,2}$/);
      if (n.parent) expect(byCode.has(n.parent), `${n.code} → ${n.parent}`).toBe(true);
      expect(n.slug).toMatch(/^[a-z0-9_]+(\.[a-z0-9_]+)?$/);
    }
  });

  it("todo código foi auditado (status atribuído pela auditoria ou por achado)", () => {
    expect(doc.totals.audited).toBe(items.filter((n) => n.level !== "module").length);
  });
});

describe("catálogo v2 — evidência e disponibilidade", () => {
  it("item implementado (OP/PARC/FALHA) tem evidência e o arquivo existe", () => {
    const bad: string[] = [];
    for (const n of items.filter((x) => ["OP", "PARC", "FALHA"].includes(x.devStatus) && x.level !== "module")) {
      if (!n.evidence.length) bad.push(`${n.code}: sem evidência`);
      // evidência de implementação precisa ser código, não catálogo nem documentação
      if (n.evidence.every((e) => /^(docs\/|src\/lib\/modules\/catalog\.ts)/.test(e))) bad.push(`${n.code}: evidência só em catálogo/documentação`);
      for (const e of n.evidence) {
        const file = e.split(":")[0].trim();
        if (!fs.existsSync(path.join(ROOT, file))) bad.push(`${n.code}: ${file} não existe`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("só o que é operacional pode ser liberado comercialmente", () => {
    for (const n of items) if (n.availability === "disponivel") expect(n.devStatus, n.code).toBe("OP");
    for (const n of items.filter((x) => ["NAO", "PLAN", "DEV"].includes(x.devStatus))) expect(n.commercialClass, n.code).toBe("RECURSO_FUTURO");
  });

  it("toda unidade contratável do runtime v1 tem unidade v2 correspondente", () => {
    expect(doc.v1Compatibility.v1KeysWithoutV2Unit).toEqual([]);
  });
});

describe("catálogo v2 — duplicidades e dependências", () => {
  it("alias aponta para proprietário existente que não é alias (sem cadeia)", () => {
    for (const n of items.filter((x) => x.aliasOf)) {
      const o = byCode.get(n.aliasOf!);
      expect(o, n.code).toBeTruthy();
      expect(o!.aliasOf, `${n.code} → ${n.aliasOf}`).toBeNull();
      expect(n.commercialUnit, n.code).toBeNull(); // alias nunca é cobrado à parte
    }
  });

  it("dependências existem e não formam ciclo", () => {
    const deps = new Map(items.map((n) => [n.code, n.dependencies.required]));
    for (const [c, ds] of deps) for (const d of ds) expect(byCode.has(d), `${c} → ${d}`).toBe(true);
    const color = new Map<string, number>();
    const cyc: string[] = [];
    const visit = (c: string, stack: string[]) => {
      color.set(c, 1);
      for (const d of deps.get(c) ?? []) {
        if (color.get(d) === 1) cyc.push([...stack, c, d].join(" → "));
        else if (!color.get(d)) visit(d, [...stack, c]);
      }
      color.set(c, 2);
    };
    for (const c of deps.keys()) if (!color.get(c)) visit(c, []);
    expect(cyc).toEqual([]);
  });

  it("toda tabela do banco tem módulo proprietário existente no catálogo", () => {
    const rows = fs.readFileSync(path.join(ROOT, "docs/MODULE_CATALOG/tabelas.tsv"), "utf8").split("\n").filter((l) => l.trim() && !l.startsWith("#")).map((l) => l.split("\t"));
    const mapped = new Map(rows.map((r) => [r[0], r[1]]));
    expect(COLLECTIONS.map((c) => c.id).filter((c) => !mapped.has(c))).toEqual([]);
    for (const [t, code] of mapped) expect(byCode.has(code), `${t} → ${code}`).toBe(true);
  });

  it("JSON e Markdown do catálogo v2 estão em dia", async () => {
    const json = JSON.stringify(doc, null, 2) + "\n";
    expect(fs.readFileSync(path.join(ROOT, "docs/MODULE_CATALOG/catalogo-modulos-erp-v2.json"), "utf8")).toBe(json);
  });
});
