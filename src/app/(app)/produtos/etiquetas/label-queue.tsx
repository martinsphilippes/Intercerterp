"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Printer, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { Notice } from "@/components/ui/empty";
import { useToast } from "@/components/ui/toast";
import { searchLabelSkusAction } from "./actions";

type Opt = { value: string; label: string };
export interface QueueItem {
  skuId: string;
  sku: string;
  name: string;
  barcode: string | null;
  copies: number;
}

/** Itens distintos por impressão (o pedido vai na URL da página de impressão). */
const MAX_QUEUE = 150;
const MAX_COPIES = 500;
const MAX_LABELS = 2000;

export function LabelQueue({
  initial,
  models,
  tables,
  categories,
  defaults,
  origin,
}: {
  initial: QueueItem[];
  models: Array<Opt & { hint: string }>;
  tables: Opt[];
  categories: Opt[];
  defaults: { model: string; tableId: string };
  origin: string | null;
}) {
  const [queue, setQueue] = useState<QueueItem[]>(initial);
  const [model, setModel] = useState(defaults.model);
  const [tableId, setTableId] = useState(defaults.tableId);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [results, setResults] = useState<Array<Omit<QueueItem, "copies">> | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();

  const total = queue.reduce((a, i) => a + i.copies, 0);
  const add = (items: Array<Omit<QueueItem, "copies">>) => {
    const next = queue.map((x) => ({ ...x }));
    let full = false;
    for (const it of items) {
      const hit = next.find((x) => x.skuId === it.skuId);
      if (hit) hit.copies = Math.min(MAX_COPIES, hit.copies + 1);
      else if (next.length < MAX_QUEUE) next.push({ ...it, copies: 1 });
      else full = true;
    }
    if (full) toast("error", `No máximo ${MAX_QUEUE} produtos diferentes por impressão.`);
    setQueue(next);
  };
  const search = () =>
    start(async () => {
      const r = await searchLabelSkusAction({ q, categoryId: cat || null });
      if (!r.ok) return toast("error", r.error);
      setResults(r.data ?? []);
    });
  const print = () => {
    if (!queue.length) return toast("error", "Adicione produtos à lista.");
    if (total > MAX_LABELS) return toast("error", `No máximo ${MAX_LABELS} etiquetas por impressão (lista com ${total}).`);
    const itens = queue.map((i) => `${i.skuId}:${i.copies}`).join(",");
    router.push(`/produtos/etiquetas?print=1&modelo=${encodeURIComponent(model)}&tabela=${encodeURIComponent(tableId)}&itens=${encodeURIComponent(itens)}`);
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
      <div className="space-y-4">
        <section className="rounded-lg border border-line bg-white p-4">
          <h2 className="text-sm font-semibold">Adicionar produtos</h2>
          <form
            className="mt-3 flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              search();
            }}
          >
            <Field label="Busca" className="min-w-[220px] flex-1">
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome, código, SKU ou GTIN" />
            </Field>
            <Field label="Categoria" className="min-w-[180px]">
              <Select value={cat} onChange={(e) => setCat(e.target.value)} options={[{ value: "", label: "Todas" }, ...categories]} />
            </Field>
            <Button type="submit" loading={pending}>
              <Search className="size-4" /> Buscar
            </Button>
          </form>
          {results && (
            <div className="mt-3 rounded-md border border-line">
              <div className="flex items-center justify-between border-b border-line px-3 py-2 text-xs text-slate-600">
                <span>{results.length} produto(s) encontrado(s){results.length >= 60 ? " — refine a busca para ver outros" : ""}</span>
                {results.length > 0 && (
                  <Button type="button" size="sm" variant="ghost" onClick={() => add(results)}>
                    <Plus className="size-4" /> Adicionar todos
                  </Button>
                )}
              </div>
              <ul className="max-h-72 divide-y divide-line overflow-auto text-sm">
                {results.map((r) => (
                  <li key={r.skuId} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="min-w-0">
                      <span className="block truncate">{r.name}</span>
                      <span className="block font-mono text-xs text-slate-500">{r.sku}{r.barcode ? ` · ${r.barcode}` : ""}</span>
                    </span>
                    <Button type="button" size="sm" onClick={() => add([r])}>
                      <Plus className="size-4" /> Adicionar
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="rounded-lg border border-line bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold">Lista de etiquetas</h2>
              {origin && <p className="text-xs text-slate-500">{origin}</p>}
            </div>
            {queue.length > 0 && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setQueue([])}>
                <Trash2 className="size-4" /> Limpar lista
              </Button>
            )}
          </div>
          {queue.length === 0 ? (
            <p className="p-6 text-center text-sm text-slate-500">Nenhum produto na lista. Busque acima ou abra a partir de um recebimento concluído.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base w-full text-sm">
                <thead><tr><th>Produto</th><th>Código de barras</th><th className="w-32 text-right">Etiquetas</th><th className="w-10" /></tr></thead>
                <tbody>
                  {queue.map((i) => (
                    <tr key={i.skuId}>
                      <td>{i.name}<span className="block font-mono text-xs text-slate-500">{i.sku}</span></td>
                      <td className="font-mono text-xs">{i.barcode ?? <span className="text-slate-500">usa o SKU</span>}</td>
                      <td>
                        <Input
                          type="number"
                          min={1}
                          max={MAX_COPIES}
                          aria-label={`Quantidade de etiquetas de ${i.name}`}
                          value={i.copies}
                          onChange={(e) => {
                            const n = Math.max(1, Math.min(MAX_COPIES, Math.floor(Number(e.target.value) || 1)));
                            setQueue((cur) => cur.map((x) => (x.skuId === i.skuId ? { ...x, copies: n } : x)));
                          }}
                          className="tabular h-8 text-right"
                        />
                      </td>
                      <td>
                        <button type="button" className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-red-700" aria-label={`Remover ${i.name}`} onClick={() => setQueue((cur) => cur.filter((x) => x.skuId !== i.skuId))}>
                          <Trash2 className="size-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <aside className="h-fit space-y-4 rounded-lg border border-line bg-white p-4 xl:sticky xl:top-20">
        <h2 className="text-sm font-semibold">Impressão</h2>
        <Field label="Modelo" hint={models.find((m) => m.value === model)?.hint}>
          <Select value={model} onChange={(e) => setModel(e.target.value)} options={models} />
        </Field>
        <Field label="Tabela de preço" hint="Preço vigente hoje na filial selecionada (como no PDV).">
          <Select value={tableId} onChange={(e) => setTableId(e.target.value)} options={tables} />
        </Field>
        <p className="text-sm">
          <strong className="tabular">{total}</strong> etiqueta(s) de <strong className="tabular">{queue.length}</strong> produto(s).
        </p>
        {total > MAX_LABELS && <Notice tone="warn">Máximo de {MAX_LABELS} etiquetas por impressão.</Notice>}
        <Button type="button" variant="accent" className="w-full" onClick={print} disabled={!queue.length || total > MAX_LABELS}>
          <Printer className="size-4" /> Visualizar e imprimir
        </Button>
        <p className="text-xs text-slate-500">A impressão é feita pelo navegador. Ajuste a escala para 100% e desmarque cabeçalhos/rodapés na janela de impressão.</p>
      </aside>
    </div>
  );
}
