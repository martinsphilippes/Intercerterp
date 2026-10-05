import Link from "next/link";
import { Pencil, Plus } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { LinkTabs } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ActionButton, ActionForm } from "@/components/ui/action-form";
import { EmptyState, Notice } from "@/components/ui/empty";
import { Checkbox, Field, FormGrid, Input, Select } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { listAll } from "@/lib/db";
import type { Doc } from "@/lib/db/types";
import { formatBps, formatMoney } from "@/lib/money";
import { formatDate, today } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { lookups } from "@/lib/server/lookups";
import { getSetting } from "@/lib/core/settings";
import { ACCOUNT_KIND_LABEL, DRE_GROUPS, lateChargeParams, METHOD_KINDS } from "@/domain/finance";
import { FormDialog } from "../_components/form-dialog";
import { buttonClass } from "@/components/ui/button";
import { PercentField } from "./percent-field";
import { saveAccountAction, saveCategoryAction, saveCostCenterAction, saveFinanceParamsAction, savePaymentMethodAction, savePaymentTermAction, setActiveAction } from "../actions";

export const metadata = { title: "Cadastros financeiros" };

type Opt = { value: string; label: string };
const yes = (v: unknown) => (v ? "Sim" : "Não");
const active = (d: Doc) => (d.active === false ? <Badge>Inativo</Badge> : <Badge tone="good">Ativo</Badge>);

export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const s = await requireSession("finance");
  const { tab = "contas" } = await searchParams;
  const company = [["eq", "companyId", s.ctx.companyId]] as any[];
  const [accounts, methods, terms, cats, ccs, branches, accountOpts] = await Promise.all([
    listAll(s.ctx.store, "financial_accounts", { filters: company }),
    listAll(s.ctx.store, "payment_methods", { filters: company }),
    listAll(s.ctx.store, "payment_terms", { filters: company }),
    listAll(s.ctx.store, "fin_categories", { filters: company }),
    listAll(s.ctx.store, "cost_centers", { filters: company }),
    lookups.branches(s.ctx),
    lookups.accounts(s.ctx),
  ]);
  const canEdit = can(s.user, "finance", "edit");
  const canCreate = can(s.user, "finance", "create");
  const accName = new Map(accounts.map((a) => [a.id, a.name]));
  const branchName = new Map(branches.map((b) => [b.value, b.label]));
  const catName = new Map(cats.map((c) => [c.id, c.name]));
  const toggle = (collection: Parameters<typeof setActiveAction>[0], d: Doc) =>
    canEdit && <ActionButton action={setActiveAction.bind(null, collection, d.id, d.active === false)} label={d.active === false ? "Reativar" : "Inativar"} size="sm" variant="ghost" confirm={d.active === false ? undefined : `Inativar "${d.name}"? O histórico é preservado e ele deixa de aparecer nas seleções.`} />;

  const accountFields = (a?: Doc) => (
    <>
      {a && <input type="hidden" name="id" value={a.id} />}
      <input type="hidden" name="active" value={a?.active === false ? "0" : "1"} />
      <FormGrid cols={2}>
        <Field label="Nome" required className="sm:col-span-2">
          <Input name="name" defaultValue={a?.name ?? ""} required maxLength={120} />
        </Field>
        <Field label="Tipo" required>
          <Select name="kind" defaultValue={a?.kind ?? "bank"} options={Object.entries(ACCOUNT_KIND_LABEL).map(([value, label]) => ({ value, label }))} />
        </Field>
        <Field label="Filial" hint="Vazio = conta compartilhada da empresa">
          <Select name="branchId" defaultValue={a?.branchId ?? ""} options={branches} placeholder="Compartilhada" />
        </Field>
        <Field label="Banco (código)">
          <Input name="bankCode" defaultValue={a?.bankCode ?? ""} maxLength={10} placeholder="341" />
        </Field>
        <Field label="Agência">
          <Input name="agency" defaultValue={a?.agency ?? ""} maxLength={20} />
        </Field>
        <Field label="Conta">
          <Input name="accountNumber" defaultValue={a?.accountNumber ?? ""} maxLength={30} />
        </Field>
        <Field label="Chave Pix">
          <Input name="pixKey" defaultValue={a?.pixKey ?? ""} maxLength={120} />
        </Field>
        <Field label="Saldo inicial" required>
          <MoneyInput name="initialBalance" defaultValue={a?.initialBalance ?? 0} />
        </Field>
        <Field label="Data de referência do saldo inicial" required hint="Saldo no início deste dia">
          <Input type="date" name="initialBalanceDate" defaultValue={a?.initialBalanceDate ?? today()} required />
        </Field>
        {a && (
          <Field label="Motivo (obrigatório se alterar o saldo inicial)" className="sm:col-span-2" hint={`Com lançamentos existentes (${a.seq ?? 0}), a alteração gera marcador no extrato e recalcula os saldos.`}>
            <Input name="reason" maxLength={300} />
          </Field>
        )}
      </FormGrid>
    </>
  );
  const methodFields = (m?: Doc) => (
    <>
      {m && <input type="hidden" name="id" value={m.id} />}
      <FormGrid cols={2}>
        <Field label="Nome" required>
          <Input name="name" defaultValue={m?.name ?? ""} required maxLength={120} />
        </Field>
        <Field label="Tipo" required>
          <Select name="kind" defaultValue={m?.kind ?? "pix"} options={METHOD_KINDS} />
        </Field>
        <Field label="Conta de destino" hint="Obrigatória para Pix/transferência/outros; em cartões é a conta onde a adquirente liquida.">
          <Select name="accountId" defaultValue={m?.accountId ?? ""} options={accountOpts} placeholder="—" />
        </Field>
        <Field label="Taxa (%)" hint="Ex.: 3,09">
          <BpsInput name="feeBps" value={m?.feeBps ?? 0} />
        </Field>
        <Field label="Prazo de liquidação (dias)">
          <Input type="number" name="settlementDays" min={0} max={400} defaultValue={m?.settlementDays ?? 0} />
        </Field>
        <Field label="Parcelas máximas">
          <Input type="number" name="maxInstallments" min={1} max={48} defaultValue={m?.maxInstallments ?? 1} />
        </Field>
        <Field label="Ordem no PDV">
          <Input type="number" name="sortOrder" min={0} max={999} defaultValue={m?.sortOrder ?? 99} />
        </Field>
      </FormGrid>
      <div className="flex flex-wrap gap-5">
        <Checkbox name="allowsChange" label="Permite troco" defaultChecked={Boolean(m?.allowsChange)} />
        <Checkbox name="requiresCustomer" label="Exige cliente identificado" defaultChecked={Boolean(m?.requiresCustomer)} />
        <Checkbox name="availablePdv" label="Disponível no PDV" defaultChecked={m ? m.availablePdv !== false : true} />
        <Checkbox name="active" label="Ativo" defaultChecked={m ? m.active !== false : true} />
      </div>
    </>
  );
  const termFields = (t?: Doc) => (
    <>
      {t && <input type="hidden" name="id" value={t.id} />}
      <FormGrid cols={2}>
        <Field label="Nome" required className="sm:col-span-2">
          <Input name="name" defaultValue={t?.name ?? ""} required maxLength={120} placeholder="Ex.: 30/60/90 dias" />
        </Field>
        <Field label="Nº de parcelas" required>
          <Input type="number" name="installments" min={1} max={60} defaultValue={t?.installments ?? 1} required />
        </Field>
        <Field label="1º vencimento (dias)" required>
          <Input type="number" name="firstDueDays" min={0} max={365} defaultValue={t?.firstDueDays ?? 30} required />
        </Field>
        <Field label="Intervalo (dias)" required hint="30 = mensal (mesmo dia do mês)">
          <Input type="number" name="intervalDays" min={1} max={365} defaultValue={t?.intervalDays ?? 30} required />
        </Field>
        <Field label="Juros (% sobre o total)">
          <BpsInput name="interestBps" value={t?.interestBps ?? 0} />
        </Field>
        <Field label="Uso">
          <Select name="kind" defaultValue={t?.kind ?? "both"} options={[{ value: "both", label: "Vendas e compras" }, { value: "sale", label: "Somente vendas" }, { value: "purchase", label: "Somente compras" }]} />
        </Field>
      </FormGrid>
      <Checkbox name="active" label="Ativa" defaultChecked={t ? t.active !== false : true} />
    </>
  );
  const catFields = (c?: Doc) => (
    <>
      {c && <input type="hidden" name="id" value={c.id} />}
      <FormGrid cols={2}>
        <Field label="Nome" required className="sm:col-span-2">
          <Input name="name" defaultValue={c?.name ?? ""} required maxLength={120} />
        </Field>
        <Field label="Tipo" required>
          <Select name="type" defaultValue={c?.type ?? "expense"} options={[{ value: "revenue", label: "Receita" }, { value: "expense", label: "Despesa" }]} />
        </Field>
        <Field label="Grupo do DRE">
          <Select name="dreGroup" defaultValue={c?.dreGroup ?? ""} options={DRE_GROUPS.map((g) => ({ value: g, label: g }))} placeholder="—" />
        </Field>
        <Field label="Categoria pai" className="sm:col-span-2">
          <Select name="parentId" defaultValue={c?.parentId ?? ""} options={cats.filter((x) => x.id !== c?.id).map((x) => ({ value: x.id, label: `${x.name} (${x.type === "revenue" ? "receita" : "despesa"})` }))} placeholder="—" />
        </Field>
      </FormGrid>
      <Checkbox name="active" label="Ativa" defaultChecked={c ? c.active !== false : true} />
    </>
  );
  const ccFields = (c?: Doc) => (
    <>
      {c && <input type="hidden" name="id" value={c.id} />}
      <FormGrid cols={2}>
        <Field label="Código">
          <Input name="code" defaultValue={c?.code ?? ""} maxLength={20} />
        </Field>
        <Field label="Nome" required>
          <Input name="name" defaultValue={c?.name ?? ""} required maxLength={120} />
        </Field>
      </FormGrid>
      <Checkbox name="active" label="Ativo" defaultChecked={c ? c.active !== false : true} />
    </>
  );
  const newBtn = (label: string, title: string, action: any, fields: React.ReactNode) =>
    canCreate && (
      <FormDialog label={label} icon={<Plus className="size-4" />} variant="primary" title={title} action={action} dialogSize="lg">
        {fields}
      </FormDialog>
    );
  const editBtn = (title: string, action: any, fields: React.ReactNode) =>
    canEdit && (
      <FormDialog label="Editar" icon={<Pencil className="size-4" />} size="sm" variant="ghost" title={title} action={action} dialogSize="lg">
        {fields}
      </FormDialog>
    );

  return (
    <>
      <PageHeader title="Cadastros financeiros" crumbs={[{ label: "Financeiro" }, { label: "Cadastros" }]} description="Contas, meios de pagamento, condições de parcelamento, categorias, centros de custo e parâmetros do financeiro." />
      <LinkTabs
        basePath="/financeiro/cadastros"
        active={tab}
        tabs={[
          { key: "contas", label: "Contas financeiras", count: accounts.length },
          { key: "meios", label: "Meios de pagamento", count: methods.length },
          { key: "condicoes", label: "Condições de parcelamento", count: terms.length },
          { key: "categorias", label: "Categorias", count: cats.length },
          { key: "centros", label: "Centros de custo", count: ccs.length },
          { key: "parametros", label: "Parâmetros" },
        ]}
      />
      {tab === "contas" && (
        <Card title="Contas financeiras" description="Caixa, banco ou carteira digital. Saldo atual = saldo inicial (a partir da data de referência) + lançamentos." actions={newBtn("Nova conta", "Nova conta financeira", saveAccountAction, accountFields())} bodyClass="p-0">
          <table className="table-base w-full text-sm">
            <thead>
              <tr>
                <th>Conta</th>
                <th>Tipo</th>
                <th>Filial</th>
                <th>Banco / agência / conta</th>
                <th className="text-right">Saldo inicial</th>
                <th className="text-right">Saldo atual</th>
                <th>Situação</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {accounts.sort((a, b) => a.name.localeCompare(b.name, "pt-BR")).map((a) => (
                <tr key={a.id}>
                  <td>
                    <Link className="font-medium text-brand-700 hover:underline" href={`/financeiro/contas/${a.id}`}>
                      {a.name}
                    </Link>
                  </td>
                  <td>{ACCOUNT_KIND_LABEL[a.kind] ?? a.kind}</td>
                  <td>{a.branchId ? branchName.get(a.branchId) : "Compartilhada"}</td>
                  <td className="text-xs">{[a.bankCode, a.agency, a.accountNumber].filter(Boolean).join(" / ") || "—"}</td>
                  <td className="tabular text-right">
                    {formatMoney(a.initialBalance ?? 0)}
                    <span className="block text-xs text-slate-500">em {formatDate(a.initialBalanceDate)}</span>
                  </td>
                  <td className="tabular text-right font-semibold">{formatMoney(a.balance ?? 0)}</td>
                  <td>{active(a)}</td>
                  <td className="text-right">
                    <div className="flex justify-end gap-1">
                      {editBtn(`Editar conta — ${a.name}`, saveAccountAction, accountFields(a))}
                      {toggle("financial_accounts", a)}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {tab === "meios" && (
        <Card title="Meios de pagamento" description="Usados no PDV e nas baixas. Cartões geram recebível contra a adquirente (taxa e prazo abaixo); Pix/outros lançam direto na conta de destino." actions={newBtn("Novo meio", "Novo meio de pagamento", savePaymentMethodAction, methodFields())} bodyClass="p-0">
          <div className="overflow-x-auto">
            <table className="table-base w-full text-sm">
              <thead>
                <tr>
                  <th>Meio</th>
                  <th>Tipo</th>
                  <th>Conta de destino</th>
                  <th className="text-right">Taxa</th>
                  <th className="text-right">Liquidação</th>
                  <th>Troco</th>
                  <th>Exige cliente</th>
                  <th>PDV</th>
                  <th className="text-right">Parcelas máx.</th>
                  <th>Situação</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {methods.sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99)).map((m) => (
                  <tr key={m.id}>
                    <td className="font-medium">{m.name}</td>
                    <td>{METHOD_KINDS.find((k) => k.value === m.kind)?.label ?? m.kind}</td>
                    <td>{m.accountId ? accName.get(m.accountId) : "—"}</td>
                    <td className="tabular text-right">{formatBps(m.feeBps ?? 0)}</td>
                    <td className="tabular text-right">{m.settlementDays ? `${m.settlementDays} dia(s)` : "Imediata"}</td>
                    <td>{yes(m.allowsChange)}</td>
                    <td>{yes(m.requiresCustomer)}</td>
                    <td>{yes(m.availablePdv !== false)}</td>
                    <td className="tabular text-right">{m.maxInstallments ?? 1}</td>
                    <td>{active(m)}</td>
                    <td className="text-right">
                      <div className="flex justify-end gap-1">
                        {editBtn(`Editar meio — ${m.name}`, savePaymentMethodAction, methodFields(m))}
                        {toggle("payment_methods", m)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {tab === "condicoes" && (
        <Card title="Condições de parcelamento" description="Geram os vencimentos de vendas a prazo, compras e títulos manuais." actions={newBtn("Nova condição", "Nova condição de parcelamento", savePaymentTermAction, termFields())} bodyClass="p-0">
          <table className="table-base w-full text-sm">
            <thead>
              <tr>
                <th>Condição</th>
                <th className="text-right">Parcelas</th>
                <th className="text-right">1º vencimento</th>
                <th className="text-right">Intervalo</th>
                <th className="text-right">Juros</th>
                <th>Uso</th>
                <th>Situação</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {terms.sort((a, b) => a.installments - b.installments || a.firstDueDays - b.firstDueDays).map((t) => (
                <tr key={t.id}>
                  <td className="font-medium">{t.name}</td>
                  <td className="tabular text-right">{t.installments}</td>
                  <td className="tabular text-right">{t.firstDueDays} dia(s)</td>
                  <td className="tabular text-right">{t.intervalDays} dia(s)</td>
                  <td className="tabular text-right">{formatBps(t.interestBps ?? 0)}</td>
                  <td>{t.kind === "sale" ? "Vendas" : t.kind === "purchase" ? "Compras" : "Vendas e compras"}</td>
                  <td>{active(t)}</td>
                  <td className="text-right">
                    <div className="flex justify-end gap-1">
                      {editBtn(`Editar condição — ${t.name}`, savePaymentTermAction, termFields(t))}
                      {toggle("payment_terms", t)}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {tab === "categorias" && (
        <Card title="Categorias financeiras" description="Classificam receitas e despesas no fluxo de caixa e no DRE." actions={newBtn("Nova categoria", "Nova categoria financeira", saveCategoryAction, catFields())} bodyClass="p-0">
          <table className="table-base w-full text-sm">
            <thead>
              <tr>
                <th>Categoria</th>
                <th>Tipo</th>
                <th>Grupo do DRE</th>
                <th>Categoria pai</th>
                <th>Situação</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {cats.sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name, "pt-BR")).map((c) => (
                <tr key={c.id}>
                  <td className="font-medium">{c.name}</td>
                  <td>{c.type === "revenue" ? <Badge tone="good">Receita</Badge> : <Badge tone="warn">Despesa</Badge>}</td>
                  <td>{c.dreGroup ?? "—"}</td>
                  <td>{c.parentId ? catName.get(c.parentId) : "—"}</td>
                  <td>{active(c)}</td>
                  <td className="text-right">
                    <div className="flex justify-end gap-1">
                      {editBtn(`Editar categoria — ${c.name}`, saveCategoryAction, catFields(c))}
                      {toggle("fin_categories", c)}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {tab === "centros" && (
        <Card title="Centros de custo" actions={newBtn("Novo centro", "Novo centro de custo", saveCostCenterAction, ccFields())} bodyClass="p-0">
          {ccs.length === 0 ? (
            <EmptyState title="Nenhum centro de custo" />
          ) : (
            <table className="table-base w-full text-sm">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Centro de custo</th>
                  <th>Situação</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {ccs.sort((a, b) => String(a.code ?? "").localeCompare(String(b.code ?? ""))).map((c) => (
                  <tr key={c.id}>
                    <td>{c.code ?? "—"}</td>
                    <td className="font-medium">{c.name}</td>
                    <td>{active(c)}</td>
                    <td className="text-right">
                      <div className="flex justify-end gap-1">
                        {editBtn(`Editar centro — ${c.name}`, saveCostCenterAction, ccFields(c))}
                        {toggle("cost_centers", c)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
      {tab === "parametros" && <Params s={s} cats={cats.filter((c) => c.active !== false).map((c) => ({ value: c.id, label: `${c.name} (${c.type === "revenue" ? "receita" : "despesa"})` }))} canEdit={canEdit} />}
    </>
  );
}

/** Percentual digitado (ex.: 3,09) enviado em pontos-base. */
function BpsInput({ name, value }: { name: string; value: number }) {
  return <PercentField name={name} value={value} />;
}

async function Params({ s, cats, canEdit }: { s: Awaited<ReturnType<typeof requireSession>>; cats: Opt[]; canEdit: boolean }) {
  const late = await lateChargeParams(s.ctx.store, s.ctx.companyId, null);
  const [window, sales, purchases, fees] = await Promise.all([
    getSetting<number>(s.ctx.store, s.ctx.companyId, null, "finance.reconcile.dateWindowDays", 5),
    getSetting<string | null>(s.ctx.store, s.ctx.companyId, null, "finance.category.sales", null),
    getSetting<string | null>(s.ctx.store, s.ctx.companyId, null, "finance.category.purchases", null),
    getSetting<string | null>(s.ctx.store, s.ctx.companyId, null, "finance.category.fees", null),
  ]);
  return (
    <Card title="Parâmetros do financeiro" description="Valem para a empresa. Encargos são apenas sugeridos na baixa — sempre editáveis.">
      {!canEdit && (
        <div className="mb-4">
          <Notice tone="info">Somente leitura para o seu perfil.</Notice>
        </div>
      )}
      <ActionForm action={saveFinanceParamsAction} className="space-y-5">
            <fieldset disabled={!canEdit} className="space-y-5">
              <div>
                <h3 className="mb-2 text-sm font-semibold">Encargos por atraso (contas a receber)</h3>
                <FormGrid cols={3}>
                  <Field label="Multa (%)" hint="Aplicada uma vez sobre o principal pago em atraso">
                    <PercentField name="fineBps" value={late.fineBps} />
                  </Field>
                  <Field label="Juros de mora (% ao mês)" hint="Simples, pro rata die (base 30 dias)">
                    <PercentField name="interestMonthlyBps" value={late.interestMonthlyBps} />
                  </Field>
                  <Field label="Tolerância (dias)" hint="Sem encargos até N dias após o vencimento">
                    <Input type="number" name="graceDays" min={0} max={60} defaultValue={late.graceDays} />
                  </Field>
                </FormGrid>
                <p className="mt-2 text-xs text-slate-500">Exemplo: R$ 100,00 pago 15 dias após o vencimento → multa {formatMoney(Math.round((10000 * late.fineBps) / 10000))} + juros {formatMoney(Math.round((10000 * late.interestMonthlyBps * 15) / 300000))}.</p>
              </div>
              <div>
                <h3 className="mb-2 text-sm font-semibold">Conciliação bancária</h3>
                <FormGrid cols={3}>
                  <Field label="Janela de datas para sugestões (± dias)">
                    <Input type="number" name="dateWindowDays" min={0} max={30} defaultValue={window} />
                  </Field>
                </FormGrid>
              </div>
              <div>
                <h3 className="mb-2 text-sm font-semibold">Categorias padrão por origem</h3>
                <FormGrid cols={3}>
                  <Field label="Vendas (PDV, cartão, crediário)">
                    <Select name="category_sales" defaultValue={sales ?? ""} options={cats} placeholder="—" />
                  </Field>
                  <Field label="Compras de mercadorias">
                    <Select name="category_purchases" defaultValue={purchases ?? ""} options={cats} placeholder="—" />
                  </Field>
                  <Field label="Tarifas bancárias e taxas de cartão">
                    <Select name="category_fees" defaultValue={fees ?? ""} options={cats} placeholder="—" />
                  </Field>
                </FormGrid>
              </div>
            </fieldset>
            {canEdit && (
              <div className="flex justify-end">
                <button type="submit" className={buttonClass("primary")}>
                  Salvar parâmetros
                </button>
              </div>
            )}
      </ActionForm>
    </Card>
  );
}
