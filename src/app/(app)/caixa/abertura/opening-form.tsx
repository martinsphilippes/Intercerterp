"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CircleDollarSign, Lock, Printer, ScanBarcode, Wifi, CreditCard } from "lucide-react";
import { ActionForm } from "@/components/ui/action-form";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button, buttonClass } from "@/components/ui/button";
import { Field, Select, Textarea, inputClass } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { cn } from "@/components/ui/cn";
import { formatMoney } from "@/lib/money";
import { PrintStyles } from "../../vendas/print-styles";
import { openSessionAction } from "../actions";

interface Props {
  operator: string;
  branch: string;
  now: string;
  terminal: { id: string; name: string; code: string; printerMode: string | null; printerName: string | null; paperWidth: number | null; scannerMode: string | null; lastPrinterTestAt: string | null; lastPrinterTestResult: string | null };
  terminals: Array<{ value: string; label: string }>;
  lastClosing: { at: string; number: number; diff: number; countedCash: number } | null;
  integrations: {
    pix: { provider: string | null; status: string; ready: boolean; simulated: boolean; lastTest: string | null };
    card: { provider: string | null; status: string; acquirer: string | null };
    fiscal: { provider: string | null; environment: string | null; status: string | null; lastTest: string | null; lastTestAt: string | null };
  };
}

const PRINTER: Record<string, string> = { browser: "Impressão pelo navegador (diálogo do sistema)", connector: "Conector local de impressão", none: "Sem impressora" };

/** Conferência: estados reais do terminal/integrações + confirmação do operador e teste do leitor executado aqui. */
export function OpeningForm(p: Props) {
  const router = useRouter();
  const [fund, setFund] = useState(0);
  const [checks, setChecks] = useState({ printer: false, scanner: false, tef: false, fiscal: false });
  const [scanText, setScanText] = useState("");
  const [scan, setScan] = useState<null | { ok: boolean; text: string; at: string }>(null);
  const [printedAt, setPrintedAt] = useState<string | null>(null);
  const testScan = async () => {
    const code = scanText.trim();
    if (!code) return;
    const res = await fetch(`/api/pdv/products?code=${encodeURIComponent(code)}`, { cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    const at = new Date().toISOString();
    if (res.ok && body.exact) setScan({ ok: true, text: `Leitura testada: ${code} → ${body.items[0].name}`, at });
    else setScan({ ok: true, text: `Leitura recebida (${code}), mas o código não corresponde a um produto cadastrado.`, at });
    setChecks((c) => ({ ...c, scanner: true }));
    setScanText("");
  };
  const peripherals = {
    printer: { mode: p.terminal.printerMode, name: p.terminal.printerName, confirmed: checks.printer, testPrintedAt: printedAt },
    scanner: { mode: p.terminal.scannerMode, tested: Boolean(scan), result: scan?.text ?? null, at: scan?.at ?? null, confirmed: checks.scanner },
    tef: { provider: p.integrations.card.provider, status: p.integrations.card.status, confirmed: checks.tef },
    pix: { provider: p.integrations.pix.provider, status: p.integrations.pix.status, ready: p.integrations.pix.ready },
    fiscal: { provider: p.integrations.fiscal.provider, environment: p.integrations.fiscal.environment, status: p.integrations.fiscal.status, acknowledged: checks.fiscal },
  };
  const Toggle = ({ k, label }: { k: keyof typeof checks; label: string }) => (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input type="checkbox" role="switch" className="peer sr-only" checked={checks[k]} onChange={(e) => setChecks({ ...checks, [k]: e.target.checked })} />
      <span className={cn("relative h-5 w-9 rounded-full transition-colors", checks[k] ? "bg-emerald-500" : "bg-slate-300")} aria-hidden>
        <span className={cn("absolute top-0.5 size-4 rounded-full bg-white transition-all", checks[k] ? "left-[18px]" : "left-0.5")} />
      </span>
      {label}
    </label>
  );
  return (
    <ActionForm action={openSessionAction}>
      {({ pending }) => (
        <div className="grid gap-4 lg:grid-cols-2">
          <PrintStyles paper="80mm" />
          <section className="rounded-lg border border-line bg-white">
            <header className="flex items-center gap-2 border-b border-line px-4 py-3"><CircleDollarSign className="size-5 text-accent-500" /><h2 className="text-sm font-semibold">Dados da abertura</h2></header>
            <div className="grid gap-4 p-4 sm:grid-cols-2">
              <Field label="Operador"><p className="text-sm font-medium">{p.operator}</p></Field>
              <Field label="Data e hora"><p className="text-sm font-medium">{p.now}</p></Field>
              <Field label="Filial"><p className="text-sm font-medium">{p.branch}</p></Field>
              <Field label="Último fechamento deste terminal">
                <p className="text-sm font-medium">{p.lastClosing ? <>{p.lastClosing.at} · {p.lastClosing.diff === 0 ? <Badge tone="good">Sem diferença</Badge> : <Badge tone="bad">Divergência {formatMoney(p.lastClosing.diff)}</Badge>}</> : "Nenhum fechamento anterior"}</p>
              </Field>
              <Field label="Terminal de caixa" className="sm:col-span-2">
                <Select value={p.terminal.id} onChange={(e) => router.push(`/caixa/abertura?terminal=${e.target.value}`)} options={p.terminals} />
              </Field>
              <input type="hidden" name="terminalId" value={p.terminal.id} />
              <Field label="Fundo de troco em dinheiro" required hint="Fundo de abertura não é receita: não entra no faturamento." className="sm:col-span-2">
                <MoneyInput name="openingFund" value={fund} onChange={setFund} autoFocus ariaLabel="Fundo de troco" className="h-11 text-lg" />
                <div className="mt-2 flex flex-wrap gap-2">{[10000, 15000, 20000, 30000].map((v) => <Button key={v} type="button" size="sm" onClick={() => setFund(v)}>{formatMoney(v)}</Button>)}</div>
              </Field>
              <Field label="Observações da abertura" className="sm:col-span-2">
                <Textarea name="notes" placeholder="Ex.: fundo recebido do financeiro, notas pequenas conferidas…" maxLength={500} />
              </Field>
            </div>
          </section>
          <section className="rounded-lg border border-line bg-white">
            <header className="border-b border-line px-4 py-3"><h2 className="text-sm font-semibold">Conferência do terminal — {p.terminal.code}</h2><p className="text-xs text-slate-500">Estados medidos/registrados; os interruptores são a confirmação do operador.</p></header>
            <ul className="divide-y divide-line">
              <li className="space-y-2 p-4">
                <p className="flex items-center gap-2 text-sm font-medium"><Printer className="size-4" /> Impressora não fiscal</p>
                <p className="text-xs text-slate-600">{PRINTER[p.terminal.printerMode ?? ""] ?? p.terminal.printerMode ?? "Não configurada"}{p.terminal.paperWidth ? ` · bobina ${p.terminal.paperWidth} mm` : ""}{p.terminal.lastPrinterTestAt ? ` · último teste registrado: ${new Date(p.terminal.lastPrinterTestAt).toLocaleString("pt-BR")} (${p.terminal.lastPrinterTestResult ?? "—"})` : ""}</p>
                <div className="flex flex-wrap items-center gap-3">
                  <Button type="button" size="sm" onClick={() => { setPrintedAt(new Date().toISOString()); setTimeout(() => window.print(), 50); }}>Imprimir página de teste</Button>
                  {printedAt && <span className="text-xs text-slate-500">Teste enviado à impressão às {new Date(printedAt).toLocaleTimeString("pt-BR")} — confira o papel.</span>}
                  <Toggle k="printer" label="Impressora conferida (papel e impressão)" />
                </div>
              </li>
              <li className="space-y-2 p-4">
                <p className="flex items-center gap-2 text-sm font-medium"><ScanBarcode className="size-4" /> Leitor de código de barras</p>
                <div className="flex gap-2">
                  <input form="pdv-scanner-test" value={scanText} onChange={(e) => setScanText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void testScan(); } }} placeholder="Leia qualquer código aqui para testar" className={cn(inputClass, "h-9")} aria-label="Teste do leitor" />
                  <Button type="button" size="sm" onClick={() => void testScan()}>Testar</Button>
                </div>
                <p className={cn("text-xs", scan ? "text-emerald-700" : "text-slate-500")}>{scan ? scan.text : `Modo: ${p.terminal.scannerMode === "keyboard_wedge" ? "emulação de teclado" : (p.terminal.scannerMode ?? "—")}. Ainda não testado nesta abertura.`}</p>
                <Toggle k="scanner" label="Leitor conferido" />
              </li>
              <li className="space-y-2 p-4">
                <p className="flex items-center gap-2 text-sm font-medium"><CreditCard className="size-4" /> TEF / maquininha</p>
                <p className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                  <StatusBadge kind="integration" status={p.integrations.card.status} />
                  {p.integrations.card.provider === "manual_pos" ? `Maquininha avulsa${p.integrations.card.acquirer ? ` (${p.integrations.card.acquirer})` : ""}: sem TEF integrado — NSU/autorização registrados manualmente.` : p.integrations.card.provider ? `Provedor: ${p.integrations.card.provider}` : "Não configurado."}
                </p>
                <Toggle k="tef" label="Maquininha ligada e conectada" />
              </li>
              <li className="space-y-2 p-4">
                <p className="flex items-center gap-2 text-sm font-medium"><Wifi className="size-4" /> Internet, SEFAZ e Pix</p>
                <p className="text-xs text-slate-600">
                  Fiscal: {p.integrations.fiscal.provider ? `${p.integrations.fiscal.provider === "simulated" ? "simulação (sem validade fiscal)" : p.integrations.fiscal.provider} · ${p.integrations.fiscal.environment ?? "—"}` : "não configurado"}
                  {p.integrations.fiscal.lastTestAt ? ` · último teste ${new Date(p.integrations.fiscal.lastTestAt).toLocaleString("pt-BR")}: ${p.integrations.fiscal.lastTest}` : p.integrations.fiscal.lastTest ? ` · ${p.integrations.fiscal.lastTest}` : " · conexão não testada"}
                </p>
                <p className="flex flex-wrap items-center gap-2 text-xs text-slate-600">Pix: <StatusBadge kind="integration" status={p.integrations.pix.simulated ? "simulated" : p.integrations.pix.status} /> {p.integrations.pix.ready ? (p.integrations.pix.simulated ? "cobranças de simulação" : "credencial presente") : "indisponível — use Pix manual com comprovante"}</p>
                <Toggle k="fiscal" label="Ciente da situação das integrações" />
              </li>
            </ul>
            <div className="space-y-3 border-t border-line p-4">
              <p className="flex gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900"><AlertTriangle className="size-4 shrink-0" />Confirme somente após contar o dinheiro e validar os equipamentos. A abertura ficará registrada na auditoria.</p>
              <dl className="space-y-1 text-sm">
                <div className="flex justify-between text-slate-600"><dt>Dinheiro contado no último fechamento</dt><dd className="tabular">{p.lastClosing ? formatMoney(p.lastClosing.countedCash) : "—"}</dd></div>
                <div className="flex justify-between text-slate-600"><dt>Fundo de troco informado</dt><dd className="tabular">{formatMoney(fund)}</dd></div>
                <div className="flex justify-between text-base font-semibold"><dt>Saldo de abertura (dinheiro esperado)</dt><dd className="tabular text-brand-800">{formatMoney(fund)}</dd></div>
              </dl>
              <input type="hidden" name="peripherals" value={JSON.stringify(peripherals)} />
              <button type="submit" disabled={pending} className={buttonClass("accent", "lg", "w-full")}>
                <Lock className="size-4" /> Abrir caixa e iniciar vendas
              </button>
              <p className="text-xs text-slate-500">Será gerado um registro com usuário, terminal, IP, data e horário.</p>
            </div>
          </section>
          <div className="print-doc hidden print:block">
            <p className="text-center font-mono text-xs">TESTE DE IMPRESSÃO — {p.terminal.code} {p.terminal.name}<br />{p.branch}<br />{new Date().toLocaleString("pt-BR")}<br />1234567890 ÁÉÍÓÚ ÇÃÕ<br />---------------------------</p>
          </div>
        </div>
      )}
    </ActionForm>
  );
}
