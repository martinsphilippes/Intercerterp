import Link from "@/components/ui/link";
import { CheckCircle2, XCircle, Plug } from "lucide-react";
import { listAll } from "@/lib/db";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Card, Stat, DefinitionList } from "@/components/ui/card";
import { Badge, SimBadge, StatusBadge } from "@/components/ui/badge";
import { LinkTabs } from "@/components/ui/tabs";
import { Notice } from "@/components/ui/empty";
import { ActionForm, ActionButton } from "@/components/ui/action-form";
import { buttonClass } from "@/components/ui/button";
import { Field, FormGrid, Input, Select, Textarea, Checkbox } from "@/components/ui/form";
import { Timeline } from "@/components/ui/timeline";
import { formatBps } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatDoc } from "@/lib/core/text";
import { can, canDo } from "@/lib/permissions";
import { getFiscalConfig, measuredStatus, PRESENCE_LABEL } from "@/domain/fiscal/service";
import { certificateDaysLeft, CRT_LABEL, issuerChecklist, numberingStatus, REGIME_LABEL, taxGroupUsage } from "@/domain/fiscal/config";
import { deleteTaxGroupAction, saveCompleteSettingsAction, saveConfigAction, saveIssuerAction, saveNatureAction, saveReformAdherenceAction, saveSimplesCreditAction, saveTaxGroupAction, setNumberAction, testConnectionAction, uploadCertificateAction } from "../actions";
import { featureOn } from "@/lib/server/features";
import { CompleteGroupFields, NatureGroupField, ReformGroupFields } from "../../produtos/cadastros/aux-forms";
import { getSetting } from "@/lib/core/settings";
import type { Store } from "@/lib/db/types";
import { DIFAL_MODE_LABEL, formatDifalModes, formatUfRates, listNatures, NATURE_KIND_LABEL, TC_SETTINGS, type OperationNature } from "@/domain/fiscal/tax-complete";
import { cscRefProblem, fiscalTokenRefProblem, secretRefProblem } from "@/domain/integrations";

export const metadata = { title: "Configurações fiscais" };

const TABS = [
  { key: "dados", label: "Dados fiscais" },
  { key: "certificado", label: "Certificado digital" },
  { key: "documentos", label: "NF-e, NFC-e e NFS-e" },
  { key: "tributacao", label: "Tributação padrão" },
  { key: "conexao", label: "Conexão e ambiente" },
  { key: "contingencia", label: "Contingência" },
  { key: "numeracao", label: "Numeração" },
  { key: "historico", label: "Histórico" },
];

/** Situação da variável de credencial: nome não permitido (com o motivo), definida ou não definida no servidor. */
function RefBadge({ problem, defined, definedLabel = "definida no servidor", missingLabel = "não definida no servidor", showReason = true }: { problem: string | null; defined: boolean; definedLabel?: string; missingLabel?: string; showReason?: boolean }) {
  if (problem) return <><Badge tone="bad">nome não permitido</Badge>{showReason && <span className="mt-1 block text-xs text-red-700">{problem}</span>}</>;
  return defined ? <Badge tone="good">{definedLabel}</Badge> : <Badge tone="warn">{missingLabel}</Badge>;
}

const submit = (label: string) => <button type="submit" className={buttonClass("accent")}>{label}</button>;
const discard = <button type="reset" className={buttonClass("ghost")}>Descartar</button>;

export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string; grupo?: string; natureza?: string }> }) {
  const s = await requireSession("fiscal");
  const { tab = "dados", grupo, natureza } = await searchParams;
  const branch = s.branch;
  const cfg = await getFiscalConfig(s.ctx.store, s.ctx.companyId, branch?.id ?? null);
  const own = cfg ? (cfg.branchId ?? null) === (branch?.id ?? null) : false;
  const canEdit = can(s.user, "fiscal", "edit") && canDo(s.user, "fiscal.configure");
  const canCfgCert = canDo(s.user, "fiscal.configure");
  const company = s.company;
  const checklist = issuerChecklist(company as any, branch as any);
  const validated = checklist.every((c) => c.ok);
  const days = certificateDaysLeft(cfg?.certificate);
  const enabledDocs = cfg ? [cfg.nfeEnabled && "NF-e", cfg.nfceEnabled && "NFC-e", cfg.nfseEnabled && "NFS-e"].filter(Boolean) : [];
  const envLabel = !cfg ? "Não configurado" : cfg.provider === "simulated" ? "Simulação" : cfg.environment === "producao" ? "Produção" : "Homologação";
  const scopeNote = branch ? (own ? `Configuração própria da filial ${branch.name}.` : `Filial ${branch.name} usando a configuração da empresa — ao salvar, a filial passa a ter configuração própria (herdando os valores atuais).`) : "Contexto consolidado: configuração padrão da empresa (vale para filiais sem configuração própria).";
  const taxGroups = await listAll(s.ctx.store, "tax_groups", { filters: [["eq", "companyId", s.ctx.companyId]], orderBy: [{ field: "name" }] });
  const reformOn = await featureOn(s, "reformaTributaria");
  // Fase 7 (tributação): aba "Operações" só com algum dos recursos ligados
  const tcOn = await featureOn(s, "tributacaoCompleta");
  const natOn = await featureOn(s, "naturezasOperacao");
  const credOn = await featureOn(s, "creditoSimples");
  const natures = natOn ? await listNatures(s.ctx.store, s.ctx.companyId, null) : [];
  const natureOptions = natOn ? natures.map((n) => ({ value: n.key, label: n.label })) : null;
  const tabs = tcOn || natOn || credOn ? [...TABS.slice(0, 4), { key: "operacoes", label: "Operações" }, ...TABS.slice(4)] : TABS;
  const tgOptions = taxGroups.map((g) => ({ value: g.id, label: g.name }));
  // nomes não permitidos (segredos do sistema, gravados antes da validação) nunca são consultados no ambiente
  // (o motivo aparece como "nome não permitido", não como "não definida" — redefinir a variável não resolveria)
  const tokenProblem = cfg?.tokenRef ? fiscalTokenRefProblem(cfg.tokenRef) : null;
  const cscProblem = cfg?.cscTokenRef ? cscRefProblem(cfg.cscTokenRef) : null;
  const certPassProblem = cfg?.certificate?.passwordRef ? secretRefProblem(cfg.certificate.passwordRef, { label: "Senha", example: "CERT_A1_SENHA" }) : null;
  const tokenDefined = cfg?.tokenRef && !tokenProblem ? Boolean(process.env[cfg.tokenRef]) : false;
  const cscDefined = cfg?.cscTokenRef && !cscProblem ? Boolean(process.env[cfg.cscTokenRef]) : false;
  const certPassDefined = cfg?.certificate?.passwordRef && !certPassProblem ? Boolean(process.env[cfg.certificate.passwordRef]) : false;
  return (
    <>
      <PageHeader
        title="Configurações fiscais"
        crumbs={[{ label: "Fiscal" }, { label: "Configurações" }]}
        description="Parâmetros de emissão e tributação por empresa/filial: emitente, certificado, documentos, séries, ambiente e contingência."
        badges={cfg?.provider === "simulated" ? <SimBadge /> : cfg ? <Badge tone={cfg.environment === "producao" ? "brand" : "info"}>{envLabel}</Badge> : null}
        actions={<Link href="/administracao/integracoes/fiscal_nfe" className={buttonClass("ghost")}><Plug className="size-4" /> Central de integrações</Link>}
      />
      <p className="mb-3 text-xs text-slate-500">{scopeNote}</p>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Ambiente de emissão" value={envLabel} hint={cfg?.provider === "focusnfe" ? "Focus NFe" : cfg?.provider === "simulated" ? "Documentos sem validade fiscal" : "Defina o provedor"} href="/fiscal/configuracoes?tab=conexao" tone={cfg?.provider === "simulated" ? "warn" : "default"} />
        <Stat label="Certificado digital" value={!cfg?.certificate ? "Não carregado" : days! < 0 ? "A1 vencido" : "A1 válido"} hint={cfg?.certificate ? `Expira em ${formatDate(cfg.certificate.validTo)} (${days} dia(s))` : "Necessário no provedor para assinatura"} href="/fiscal/configuracoes?tab=certificado" tone={!cfg?.certificate ? "warn" : days! < 0 ? "bad" : days! <= 30 ? "warn" : "good"} />
        <Stat label="Documentos ativos" value={`${enabledDocs.length} de 3`} hint={enabledDocs.join(", ") || "Nenhum habilitado"} href="/fiscal/configuracoes?tab=documentos" />
        <Stat label="Última verificação" value={cfg?.lastTestAt ? formatDateTime(cfg.lastTestAt) : "Nunca"} hint={cfg?.lastTestAt ? (cfg.lastTestResult ?? "—") : "Sem teste registrado — execute o teste de conexão"} href="/fiscal/configuracoes?tab=conexao" tone={["operational", "simulated"].includes(measuredStatus(cfg)) ? "good" : measuredStatus(cfg) === "error" ? "bad" : "warn"} />
      </div>
      <LinkTabs basePath="/fiscal/configuracoes" active={tab} tabs={tabs} />
      {!canEdit && <div className="mb-4"><Notice tone="info">Somente leitura: alterar exige a permissão “Configurar fiscal e certificados”.</Notice></div>}

      {tab === "dados" && (
        <Card title="Identificação fiscal" actions={validated ? <Badge tone="good">Cadastro validado</Badge> : <Badge tone="warn">Cadastro incompleto</Badge>}>
          <ActionForm action={saveIssuerAction} className="space-y-4">
            <FormGrid cols={3}>
              <Field label="Razão social" required><Input name="name" defaultValue={company.name} required /></Field>
              <Field label="Nome fantasia"><Input name="tradeName" defaultValue={company.tradeName ?? ""} /></Field>
              <Field label="CNPJ (empresa)" required><Input name="cnpj" defaultValue={formatDoc(company.cnpj)} required /></Field>
              <Field label="Inscrição estadual (empresa)"><Input name="ie" defaultValue={company.ie ?? ""} /></Field>
              <Field label="Inscrição municipal (empresa)"><Input name="im" defaultValue={company.im ?? ""} /></Field>
              <Field label="CNAE principal"><Input name="cnae" defaultValue={company.cnae ?? ""} /></Field>
              <Field label="Regime tributário" required><Select name="regime" defaultValue={company.regime ?? "simples"} options={Object.entries(REGIME_LABEL).map(([value, label]) => ({ value, label }))} /></Field>
              <Field label="CRT" required><Select name="crt" defaultValue={company.crt ?? "1"} options={Object.entries(CRT_LABEL).map(([value, label]) => ({ value, label }))} /></Field>
            </FormGrid>
            {branch ? (
              <>
                <p className="text-xs font-semibold text-slate-600">Filial emitente — {branch.name}</p>
                <FormGrid cols={4}>
                  <Field label="CNPJ da filial"><Input name="branchCnpj" defaultValue={formatDoc(branch.cnpj)} /></Field>
                  <Field label="Inscrição estadual"><Input name="branchIe" defaultValue={branch.ie ?? ""} /></Field>
                  <Field label="Inscrição municipal"><Input name="branchIm" defaultValue={branch.im ?? ""} /></Field>
                  <Field label="UF de emissão"><Input name="uf" maxLength={2} defaultValue={branch.uf ?? ""} /></Field>
                  <Field label="Código do município (IBGE)" hint="7 dígitos"><Input name="cityCode" defaultValue={branch.cityCode ?? ""} /></Field>
                  <Field label="Município"><Input name="cityName" defaultValue={branch.cityName ?? ""} /></Field>
                  <Field label="Logradouro"><Input name="street" defaultValue={branch.address?.street ?? ""} /></Field>
                  <Field label="Número / bairro / CEP">
                    <div className="flex gap-1">
                      <Input name="number" className="w-16" defaultValue={branch.address?.number ?? ""} />
                      <Input name="district" defaultValue={branch.address?.district ?? ""} />
                      <Input name="zip" className="w-24" defaultValue={branch.address?.zip ?? ""} />
                    </div>
                  </Field>
                </FormGrid>
              </>
            ) : (
              <Notice tone="info">Selecione uma filial para editar CNPJ/IE/IM, UF e município da filial emitente.</Notice>
            )}
            <ul className="grid gap-1 text-sm sm:grid-cols-3">
              {checklist.map((c) => (
                <li key={c.label} className="flex items-center gap-1.5">{c.ok ? <CheckCircle2 className="size-4 text-emerald-600" /> : <XCircle className="size-4 text-red-600" />}{c.label}</li>
              ))}
            </ul>
            {canEdit && <div className="flex justify-end gap-2">{discard}{submit("Salvar alterações")}</div>}
          </ActionForm>
        </Card>
      )}

      {tab === "certificado" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Certificado A1 atual">
            {cfg?.certificate ? (
              <DefinitionList
                cols={1}
                items={[
                  { label: "Titular", value: cfg.certificate.subject },
                  { label: "CNPJ no certificado", value: cfg.certificate.cnpj ? formatDoc(cfg.certificate.cnpj) : "Não identificado" },
                  { label: "Emissor (AC)", value: cfg.certificate.issuer },
                  { label: "Validade", value: <span>{formatDate(cfg.certificate.validFrom)} a {formatDate(cfg.certificate.validTo)} <Badge tone={days! < 0 ? "bad" : days! <= 30 ? "warn" : "good"}>{days! < 0 ? "vencido" : `${days} dia(s) restantes`}</Badge></span> },
                  // .pfx contém a chave privada: download e nome da variável da senha só para quem configura o fiscal
                  { label: "Arquivo", value: canCfgCert ? <a className="text-brand-700 underline" href={`/api/files/${cfg.certificate.fileId}`}>{cfg.certificate.fileName}</a> : <span>{cfg.certificate.fileName}{cfg.certificate.sha256 ? <span className="block font-mono text-xs text-slate-500">SHA-256 {String(cfg.certificate.sha256).slice(0, 16)}…</span> : null}</span> },
                  { label: "Senha (referência)", value: <span>{canCfgCert ? <>variável <code>{cfg.certificate.passwordRef}</code> — </> : null}<RefBadge problem={certPassProblem} defined={Boolean(certPassDefined)} missingLabel="não definida" showReason={canCfgCert} /></span> },
                  { label: "Carregado em", value: `${formatDateTime(cfg.certificate.uploadedAt)} por ${cfg.certificate.uploadedBy}` },
                  (cfg.certificate.warnings ?? []).length > 0 && { label: "Alertas", value: <span className="text-amber-800">{cfg.certificate.warnings.join(" ")}</span> },
                ]}
              />
            ) : (
              <p className="text-sm text-slate-500">Nenhum certificado carregado nesta configuração.</p>
            )}
            <p className="mt-3 text-xs text-slate-500">A assinatura dos documentos é feita pelo provedor (Focus NFe) com o certificado cadastrado no painel dele; aqui o sistema guarda a cópia e monitora a validade (alerta automático 30 e 7 dias antes).</p>
          </Card>
          {canEdit && (
            <Card title="Carregar/renovar certificado (.pfx)">
              <ActionForm action={uploadCertificateAction} className="space-y-3" resetOnSuccess>
                <input type="hidden" name="scope" value={branch ? "branch" : "company"} />
                <Field label="Arquivo .pfx/.p12" required><Input type="file" name="file" accept=".pfx,.p12" required /></Field>
                <Field label="Senha do certificado" hint="Usada só agora para ler titular e validade — não é gravada." required><Input type="password" name="password" autoComplete="off" required /></Field>
                <Field label="Variável de ambiente que guarda a senha" hint="Somente o NOME é gravado (ex.: CERT_A1_SENHA)." required><Input name="passwordRef" defaultValue={cfg?.certificate?.passwordRef ?? "CERT_A1_SENHA"} required /></Field>
                <div className="flex justify-end">{submit("Ler e salvar certificado")}</div>
              </ActionForm>
            </Card>
          )}
        </div>
      )}

      {tab === "documentos" && cfg && (
        <Card title="Documentos eletrônicos, séries e regras">
          <ActionForm action={saveConfigAction} className="space-y-5">
            <input type="hidden" name="section" value="documents" />
            <input type="hidden" name="scope" value={branch ? "branch" : "company"} />
            <div className="grid gap-4 sm:grid-cols-3">
              {[["nfeEnabled", "NF-e (modelo 55)", "nfeSeries", cfg.nfeSeries], ["nfceEnabled", "NFC-e (modelo 65)", "nfceSeries", cfg.nfceSeries], ["nfseEnabled", "NFS-e (serviços)", "nfseSeries", cfg.nfseSeries]].map(([k, label, sk, sv]) => (
                <div key={k as string} className="rounded-md border border-line p-3">
                  <Checkbox name={k as string} label={`Habilitar ${label}`} defaultChecked={Boolean(cfg[k as string])} />
                  <Field label={k === "nfseEnabled" ? "Série do RPS" : "Série"} className="mt-2"><Input name={sk as string} defaultValue={String(sv ?? 1)} /></Field>
                </div>
              ))}
            </div>
            <FormGrid cols={3}>
              <Field label="Padrão da NFS-e"><Select name="nfseStandard" defaultValue={cfg.nfseStandard ?? "municipal"} options={[{ value: "municipal", label: "Municipal (via provedor — /v2/nfse)" }, { value: "nacional", label: "Nacional (DPS — /v2/nfsen)" }]} /></Field>
              <Field label="Indicador de presença padrão"><Select name="defaultPresence" defaultValue={cfg.defaultPresence ?? "1"} options={Object.entries(PRESENCE_LABEL).map(([value, label]) => ({ value, label }))} /></Field>
              <Field label="Natureza da operação padrão (NF-e)"><Input name="defaultNature" defaultValue={cfg.defaultNature ?? "Venda de mercadoria"} /></Field>
              <Field label="Prazo de cancelamento NF-e (horas)" hint="Parâmetro — confirme a regra da SEFAZ da UF."><Input type="number" min={1} name="nfeCancelHours" defaultValue={cfg.nfeCancelHours ?? 24} /></Field>
              <Field label="Prazo de cancelamento NFC-e (minutos)" hint="Parâmetro — confirme a regra da SEFAZ da UF."><Input type="number" min={1} name="nfceCancelMinutes" defaultValue={cfg.nfceCancelMinutes ?? 30} /></Field>
            </FormGrid>
            <div className="space-y-2 rounded-md border border-line p-3">
              <p className="text-sm font-semibold">Validação e envio</p>
              <Checkbox label="Validar cadastro do emitente/destinatário/itens antes de transmitir (sempre ativo: impede emissão com dados obrigatórios ausentes)" checked disabled readOnly />
              <Checkbox name="checkAvailability" label="Consultar disponibilidade do serviço antes de transmitir (teste real, reaproveitado por 10 min; indisponível → documento fica em erro e é reenviado depois)" defaultChecked={Boolean(cfg.checkAvailability)} />
              <Checkbox name="autoEmail" label="Enviar o XML automaticamente ao e-mail do destinatário após a autorização (pelo canal de e-mail configurado; resultado registrado nos eventos)" defaultChecked={Boolean(cfg.autoEmail)} />
            </div>
            {canEdit && <div className="flex justify-end gap-2">{discard}{submit("Salvar alterações")}</div>}
          </ActionForm>
        </Card>
      )}

      {tab === "tributacao" && (
        <div className="space-y-4">
          {cfg && (
            <Card title="Tributação padrão da filial">
              <ActionForm action={saveConfigAction} className="space-y-3">
                <input type="hidden" name="section" value="taxdefault" />
                <input type="hidden" name="scope" value={branch ? "branch" : "company"} />
                <FormGrid cols={3}>
                  <Field label="Grupo tributário padrão" hint="Usado quando o produto não tem grupo."><Select name="defaultTaxGroupId" defaultValue={cfg.defaultTaxGroupId ?? ""} placeholder="—" options={tgOptions} /></Field>
                  <Field label="Tributos aproximados padrão (%)" hint="Lei 12.741/2012 — use a carga média do IBPT; o grupo pode sobrepor."><Input name="approxTax" defaultValue={cfg.approxTaxBps ? String(cfg.approxTaxBps / 100).replace(".", ",") : ""} /></Field>
                </FormGrid>
                {canEdit && <div className="flex justify-end gap-2">{discard}{submit("Salvar")}</div>}
              </ActionForm>
            </Card>
          )}
          {cfg && reformOn && (
            <Card title="Reforma tributária — adesão (IBS, CBS e IS)" description="Com a adesão e a partir da data de início, a NF-e e a NFC-e levam os grupos IBS/CBS (e IS) dos itens cujo grupo tributário tem CST/cClassTrib da reforma. ICMS, PIS, COFINS e o total da nota não mudam.">
              <ActionForm action={saveReformAdherenceAction} className="space-y-3">
                <input type="hidden" name="scope" value={branch ? "branch" : "company"} />
                <Checkbox name="reformAdherence" label="Aderir: emitir os grupos IBS/CBS/IS nos documentos desta configuração" defaultChecked={Boolean(cfg.reformAdherence)} />
                <FormGrid cols={3}>
                  <Field label="Início da adesão" hint="Documentos emitidos antes desta data saem sem os grupos."><Input type="date" name="reformAdherenceFrom" defaultValue={cfg.reformAdherenceFrom ?? ""} /></Field>
                </FormGrid>
                <p className="text-xs text-slate-500">
                  {cfg.reformAdherence ? `Aderida desde ${formatDate(cfg.reformAdherenceFrom)}.` : "Sem adesão: os documentos saem como antes."} Período de teste de 2026 (LC 214/2025): CBS 0,9% e IBS 0,1%, informados no grupo tributário. Optantes do Simples Nacional não estão sujeitos às alíquotas de teste. Valide com a contabilidade e emita primeiro em homologação. <Link className="text-brand-700 hover:underline" href="/ajuda/artigos/reforma-tributaria-ibs-cbs">Ajuda: reforma tributária</Link>
                </p>
                {canEdit && <div className="flex justify-end gap-2">{discard}{submit("Salvar adesão")}</div>}
              </ActionForm>
            </Card>
          )}
          <Card title="Grupos tributários (com vigência)" description="Mesma tabela de Produtos → Cadastros auxiliares → Grupos tributários; aqui com vigência e tributos aproximados." actions={<><Link href="/produtos/cadastros?tab=grupos" className={buttonClass("ghost", "sm")}>Ver em Produtos</Link>{canEdit && <Link href="/fiscal/configuracoes?tab=tributacao&grupo=novo" className={buttonClass("secondary", "sm")}>Novo grupo</Link>}</>} bodyClass="p-0">
            <div className="overflow-x-auto">
              <table className="table-base w-full text-sm">
                <thead><tr><th>Grupo</th><th>CST/CSOSN</th><th>CFOP int./inter./dev.</th><th>ICMS</th><th>PIS/COFINS</th>{reformOn && <th>IBS/CBS</th>}<th>Trib. aprox.</th><th>Vigência</th><th>Situação</th><th>Uso</th><th /></tr></thead>
                <tbody>
                  {await Promise.all(
                    taxGroups.map(async (g) => {
                      const u = await taxGroupUsage(s.ctx, g.id);
                      const today = new Date().toISOString().slice(0, 10);
                      const vig = g.validTo && g.validTo < today ? "Encerrada" : g.validFrom && g.validFrom > today ? "Futura" : "Vigente";
                      return (
                        <tr key={g.id}>
                          <td><Link className="text-brand-700 hover:underline" href={`/fiscal/configuracoes?tab=tributacao&grupo=${g.id}`}>{g.name}</Link></td>
                          <td className="font-mono text-xs">{g.cstCsosn}</td>
                          <td className="font-mono text-xs">{g.cfopInternal}/{g.cfopInterstate}/{g.cfopReturn ?? "—"}</td>
                          <td>{formatBps(g.icmsRateBps ?? 0)}</td>
                          <td className="text-xs">{g.pisCst} {formatBps(g.pisRateBps ?? 0)} / {g.cofinsCst} {formatBps(g.cofinsRateBps ?? 0)}</td>
                          {reformOn && <td className="text-xs">{g.ibsCbsCst ? <><span className="font-mono">{g.ibsCbsCst}/{g.cClassTrib ?? "—"}</span> {formatBps(g.ibsRateBps ?? 0)}/{formatBps(g.cbsRateBps ?? 0)}</> : "—"}</td>}
                          <td>{g.approxTaxBps ? formatBps(g.approxTaxBps) : "—"}</td>
                          <td className="text-xs">{g.validFrom ? formatDate(g.validFrom) : "—"} a {g.validTo ? formatDate(g.validTo) : "indeterminado"}</td>
                          <td>{g.active === false ? <Badge>Inativo</Badge> : <Badge tone={vig === "Vigente" ? "good" : "warn"}>{vig}</Badge>}</td>
                          <td className="text-xs"><Link className="text-brand-700 hover:underline" href={`/produtos?taxGroup=${g.id}`}>{u.products} produto(s)</Link>{u.configs ? ` · padrão em ${u.configs}` : ""}</td>
                          <td>{canEdit && !u.products && !u.configs && <ActionButton action={deleteTaxGroupAction.bind(null, g.id)} label="Excluir" size="sm" variant="ghost" confirm={`Excluir o grupo "${g.name}"?`} />}</td>
                        </tr>
                      );
                    }),
                  )}
                </tbody>
              </table>
            </div>
          </Card>
          {grupo && canEdit && <TaxGroupForm group={grupo === "novo" ? null : (taxGroups.find((g) => g.id === grupo) ?? null)} reformOn={reformOn} tcOn={tcOn} natureOptions={natureOptions} />}
        </div>
      )}

      {tab === "operacoes" && (tcOn || natOn || credOn) && (
        <OperationsTab store={s.ctx.store} companyId={s.ctx.companyId} canEdit={canEdit} natOn={natOn} tcOn={tcOn} credOn={credOn} natures={natures} natureza={natureza ?? null} simples={["simples", "mei"].includes(String(company.regime))} />
      )}

      {tab === "conexao" && (
        <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
          <Card title="Provedor, ambiente e credenciais">
            {cfg ? (
              <ActionForm action={saveConfigAction} className="space-y-4" confirm="Alterar a conexão fiscal? Em Produção os documentos têm validade fiscal; Homologação e Simulação não. A situação volta para 'configurada sem teste'.">
                <input type="hidden" name="section" value="connection" />
                <input type="hidden" name="scope" value={branch ? "branch" : "company"} />
                <FormGrid cols={2}>
                  <Field label="Provedor"><Select name="provider" defaultValue={cfg.provider ?? "simulated"} options={[{ value: "focusnfe", label: "Focus NFe" }, { value: "simulated", label: "Simulação (sem validade fiscal)" }]} /></Field>
                  <Field label="Ambiente" hint="Homologação e produção são contextos distintos no provedor."><Select name="environment" defaultValue={cfg.environment ?? "homologacao"} options={[{ value: "homologacao", label: "Homologação (testes)" }, { value: "producao", label: "Produção (validade fiscal)" }]} /></Field>
                  <Field label="Variável de ambiente do token" hint={<span>Somente o NOME. {cfg.tokenRef ? <RefBadge problem={tokenProblem} defined={Boolean(tokenDefined)} /> : null}</span>}><Input name="tokenRef" defaultValue={cfg.tokenRef ?? "FOCUSNFE_TOKEN"} /></Field>
                  <Field label="CSC da NFC-e — ID (idToken)"><Input name="cscId" defaultValue={cfg.cscId ?? ""} /></Field>
                  <Field label="CSC da NFC-e — variável do código" hint={<span>Somente o NOME. {cfg.cscTokenRef ? <RefBadge problem={cscProblem} defined={Boolean(cscDefined)} definedLabel="definida" missingLabel="não definida" /> : null}</span>}><Input name="cscTokenRef" defaultValue={cfg.cscTokenRef ?? "NFCE_CSC"} /></Field>
                </FormGrid>
                {canEdit && <div className="flex justify-end gap-2">{discard}{submit("Salvar conexão")}</div>}
              </ActionForm>
            ) : (
              <Notice tone="warn">Sem configuração fiscal. Cadastre a conexão na <Link className="underline" href="/administracao/integracoes/fiscal_nfe">Central de integrações</Link>.</Notice>
            )}
          </Card>
          <Card title="Situação medida">
            <DefinitionList
              cols={1}
              items={[
                { label: "Situação", value: <StatusBadge kind="integration" status={measuredStatus(cfg)} /> },
                { label: "Último teste", value: cfg?.lastTestAt ? formatDateTime(cfg.lastTestAt) : "Nunca" },
                { label: "Resultado", value: cfg?.lastTestResult ?? "—" },
              ]}
            />
            <p className="mt-3 text-xs text-slate-500">A situação só muda com um teste real ao provedor. Configuração preenchida não equivale a conexão operacional.</p>
            {cfg && <div className="mt-3"><ActionButton action={testConnectionAction.bind(null, branch ? "branch" : "company")} label="Testar conexão agora" variant="primary" /></div>}
          </Card>
        </div>
      )}

      {tab === "contingencia" && cfg && (
        <Card title="Contingência">
          <ActionForm action={saveConfigAction} className="space-y-4">
            <input type="hidden" name="section" value="contingency" />
            <input type="hidden" name="scope" value={branch ? "branch" : "company"} />
            <Checkbox name="contingency" label="Contingência ativa nesta filial (NFC-e novas ficam retidas na fila, sem autorização)" defaultChecked={Boolean(cfg.contingency)} />
            <Field label="Motivo"><Textarea name="contingencyReason" defaultValue={cfg.contingencyReason ?? ""} /></Field>
            {cfg.contingency && <p className="text-xs text-amber-800">Ativa desde {formatDateTime(cfg.contingencySince)}. Desativar libera a fila para transmissão automática.</p>}
            {cfg.provider === "simulated" && <Checkbox name="simulateOutage" label="Simular indisponibilidade do provedor (somente simulação — para treinar o fluxo de pendências/retransmissão)" defaultChecked={Boolean(cfg.simulateOutage)} />}
            <Notice tone="info">A contingência offline legal da NFC-e (tpEmis 9, XML assinado localmente) é realizada pelo provedor quando habilitada na conta dele; o retorno “contingência offline” do provedor é refletido no documento. Esta opção do sistema apenas retém a fila de transmissão.</Notice>
            {canEdit && <div className="flex justify-end gap-2">{discard}{submit("Salvar")}</div>}
          </ActionForm>
        </Card>
      )}

      {tab === "numeracao" && (
        <Card title="Numeração (próximo número)" description="Os números são atribuídos na primeira transmissão e mantidos nas retransmissões. Só é possível avançar a numeração; lacunas devem ser inutilizadas.">
          {branch ? (
            <table className="table-base w-full text-sm">
              <thead><tr><th>Documento</th><th>Série</th><th>Origem da série</th><th className="text-right">Próximo número</th><th>Ajustar</th></tr></thead>
              <tbody>
                {(await numberingStatus(s.ctx, branch.id, cfg)).map((r) => (
                  <tr key={`${r.model}-${r.series}`}>
                    <td>{r.model === "nfe" ? "NF-e" : r.model === "nfce" ? "NFC-e" : "NFS-e (RPS)"}</td>
                    <td>{r.series}</td>
                    <td className="text-xs text-slate-500">{r.source}</td>
                    <td className="tabular text-right font-semibold">{r.next}</td>
                    <td>
                      {canEdit && (
                        <ActionForm action={setNumberAction} className="flex gap-2" confirm="Avançar a numeração? Números pulados deverão ser inutilizados.">
                          <input type="hidden" name="model" value={r.model} />
                          <input type="hidden" name="series" value={r.series} />
                          <Input name="next" type="number" min={r.next} defaultValue={r.next} className="w-28" />
                          <button type="submit" className={buttonClass("secondary", "sm")}>Aplicar</button>
                        </ActionForm>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Notice tone="info">Selecione uma filial para ver a numeração.</Notice>
          )}
        </Card>
      )}

      {tab === "historico" && (
        <Card title="Histórico de alterações">
          <Timeline store={s.ctx.store} refs={[`fiscal_config:${cfg?.id ?? "-"}`, `company:${s.ctx.companyId}`, ...(branch ? [`branch:${branch.id}`] : [])]} />
        </Card>
      )}
    </>
  );
}

function TaxGroupForm({ group, reformOn, tcOn, natureOptions }: { group: Record<string, any> | null; reformOn: boolean; tcOn: boolean; natureOptions: Array<{ value: string; label: string }> | null }) {
  const g = group ?? {};
  const pc = (v?: number | null) => (v ? String(v / 100).replace(".", ",") : "");
  return (
    <Card title={group ? `Editar grupo: ${g.name}` : "Novo grupo tributário"}>
      <ActionForm action={saveTaxGroupAction} className="space-y-4">
        {group && <input type="hidden" name="id" value={g.id} />}
        <FormGrid cols={4}>
          <Field label="Nome" required className="sm:col-span-2"><Input name="name" defaultValue={g.name ?? ""} required /></Field>
          <Field label="Regime"><Select name="regime" defaultValue={g.regime ?? "simples"} options={Object.entries(REGIME_LABEL).map(([value, label]) => ({ value, label }))} /></Field>
          <Field label="CST/CSOSN" required><Input name="cstCsosn" defaultValue={g.cstCsosn ?? "102"} required /></Field>
          <Field label="CFOP interno" required><Input name="cfopInternal" defaultValue={g.cfopInternal ?? "5102"} required /></Field>
          <Field label="CFOP interestadual" required><Input name="cfopInterstate" defaultValue={g.cfopInterstate ?? "6102"} required /></Field>
          <Field label="CFOP devolução (entrada)"><Input name="cfopReturn" defaultValue={g.cfopReturn ?? "1202"} /></Field>
          <Field label="ICMS (%)"><Input name="icmsRate" defaultValue={pc(g.icmsRateBps)} /></Field>
          <Field label="Redução BC ICMS (%)"><Input name="icmsBaseReduction" defaultValue={pc(g.icmsBaseReductionBps)} /></Field>
          <Field label="FCP (%)"><Input name="fcpRate" defaultValue={pc(g.fcpRateBps)} /></Field>
          <Field label="CST PIS" required><Input name="pisCst" defaultValue={g.pisCst ?? "49"} required /></Field>
          <Field label="PIS (%)"><Input name="pisRate" defaultValue={pc(g.pisRateBps)} /></Field>
          <Field label="CST COFINS" required><Input name="cofinsCst" defaultValue={g.cofinsCst ?? "49"} required /></Field>
          <Field label="COFINS (%)"><Input name="cofinsRate" defaultValue={pc(g.cofinsRateBps)} /></Field>
          <Field label="CST IPI"><Input name="ipiCst" defaultValue={g.ipiCst ?? ""} /></Field>
          <Field label="IPI (%)"><Input name="ipiRate" defaultValue={pc(g.ipiRateBps)} /></Field>
          <Field label="Tributos aproximados (%)" hint="Lei 12.741/2012"><Input name="approxTax" defaultValue={pc(g.approxTaxBps)} /></Field>
          <Field label="Vigente de"><Input type="date" name="validFrom" defaultValue={g.validFrom ?? ""} /></Field>
          <Field label="Vigente até"><Input type="date" name="validTo" defaultValue={g.validTo ?? ""} /></Field>
        </FormGrid>
        {tcOn && <CompleteGroupFields row={g} />}
        {natureOptions && <NatureGroupField row={g} options={natureOptions} />}
        {reformOn && <ReformGroupFields row={g} />}
        <Field label="Observações"><Textarea name="notes" defaultValue={g.notes ?? ""} /></Field>
        <Checkbox name="active" label="Ativo" defaultChecked={g.active !== false} />
        <p className="text-xs text-slate-500">Grupo fora da vigência ou inativo gera pendência nos documentos dos produtos que o usam (não transmite).</p>
        <div className="flex justify-end gap-2">
          <Link href="/fiscal/configuracoes?tab=tributacao" className={buttonClass("ghost")}>Fechar</Link>
          {submit("Salvar grupo")}
        </div>
      </ActionForm>
    </Card>
  );
}

const PURPOSE_OPTS = [
  { value: "normal", label: "1 — Normal" },
  { value: "devolucao", label: "4 — Devolução" },
  { value: "complementar", label: "2 — Complementar" },
  { value: "ajuste", label: "3 — Ajuste" },
];

/**
 * Aba "Operações" (Fase 7): naturezas de operação (FIS-11/07), opções da tributação completa (DIFAL por UF, PIS/COFINS sem
 * ICMS, alíquotas internas por UF — FIS-12/16) e crédito do Simples (FIS-13). Cada bloco só aparece com o seu recurso.
 */
async function OperationsTab({ store, companyId, canEdit, natOn, tcOn, credOn, natures, natureza, simples }: { store: Store; companyId: string; canEdit: boolean; natOn: boolean; tcOn: boolean; credOn: boolean; natures: OperationNature[]; natureza: string | null; simples: boolean }) {
  const [pisCofins, difalDefault, difalModes, ufRates, credit] = await Promise.all([
    getSetting<boolean>(store, companyId, null, TC_SETTINGS.pisCofinsExcludeIcms, false),
    getSetting<string>(store, companyId, null, TC_SETTINGS.difalDefaultMode, "fora"),
    getSetting<Record<string, any>>(store, companyId, null, TC_SETTINGS.difalModeByUf, {}),
    getSetting<Record<string, any>>(store, companyId, null, TC_SETTINGS.ufRates, {}),
    getSetting<number | null>(store, companyId, null, TC_SETTINGS.simplesCreditBps, null),
  ]);
  const editing = natureza === "nova" ? null : (natures.find((n) => n.key === natureza) ?? null);
  return (
    <div className="space-y-4">
      <Notice tone="warn">Regras de tributação da Fase 7 — hipóteses de implementação: valide com a contabilidade e emita primeiro em homologação. Os parâmetros valem para a empresa inteira.</Notice>
      {natOn && (
        <Card title="Naturezas de operação" description="Escolhidas no assistente da NF-e: definem o CFOP interno/interestadual e o CST/CSOSN padrão dos itens (vazio = do grupo tributário). Um grupo tributário marcado com a natureza vale para todos os itens." actions={canEdit && <Link href="/fiscal/configuracoes?tab=operacoes&natureza=nova" className={buttonClass("secondary", "sm")}>Nova natureza</Link>} bodyClass="p-0">
          <div className="overflow-x-auto">
            <table className="table-base w-full text-sm">
              <thead><tr><th>Natureza</th><th>Código</th><th>Operação</th><th>CFOP int./inter.</th><th>CSOSN / CST</th><th>Situação</th></tr></thead>
              <tbody>
                {natures.map((n) => (
                  <tr key={n.key}>
                    <td>{canEdit ? <Link className="text-brand-700 hover:underline" href={`/fiscal/configuracoes?tab=operacoes&natureza=${n.key}`}>{n.label}</Link> : n.label}</td>
                    <td className="font-mono text-xs">{n.key}</td>
                    <td className="text-xs">{n.operationType === "entrada" ? "Entrada" : "Saída"} · {NATURE_KIND_LABEL[n.kind]}{n.purpose !== "normal" ? ` · finalidade ${PURPOSE_OPTS.find((o) => o.value === n.purpose)?.label ?? n.purpose}` : ""}</td>
                    <td className="font-mono text-xs">{n.cfopInternal ?? "grupo"}/{n.cfopInterstate ?? "grupo"}</td>
                    <td className="font-mono text-xs">{n.cstSimples ?? "grupo"} / {n.cstNormal ?? "grupo"}</td>
                    <td>{n.active === false ? <Badge>Inativa</Badge> : <Badge tone="good">Ativa</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {natOn && natureza && canEdit && (
        <Card title={editing ? `Editar natureza: ${editing.label}` : "Nova natureza de operação"}>
          <ActionForm action={saveNatureAction} className="space-y-4">
            {editing && <input type="hidden" name="originalKey" value={editing.key} />}
            <FormGrid cols={4}>
              <Field label="Descrição (natOp)" required className="sm:col-span-2"><Input name="label" defaultValue={editing?.label ?? ""} maxLength={60} required /></Field>
              <Field label="Código" required hint="Letras minúsculas, números e _."><Input name="key" defaultValue={editing?.key ?? ""} maxLength={40} className="font-mono" required /></Field>
              <Field label="Tipo"><Select name="kind" defaultValue={editing?.kind ?? "other"} options={Object.entries(NATURE_KIND_LABEL).map(([value, label]) => ({ value, label }))} /></Field>
              <Field label="Operação"><Select name="operationType" defaultValue={editing?.operationType ?? "saida"} options={[{ value: "saida", label: "Saída" }, { value: "entrada", label: "Entrada" }]} /></Field>
              <Field label="Finalidade"><Select name="purpose" defaultValue={editing?.purpose ?? "normal"} options={PURPOSE_OPTS} /></Field>
              <Field label="CFOP interno" hint="Vazio = do grupo."><Input name="cfopInternal" defaultValue={editing?.cfopInternal ?? ""} maxLength={4} className="font-mono" /></Field>
              <Field label="CFOP interestadual" hint="Vazio = do grupo."><Input name="cfopInterstate" defaultValue={editing?.cfopInterstate ?? ""} maxLength={4} className="font-mono" /></Field>
              <Field label="CSOSN padrão (Simples)" hint="Vazio = do grupo."><Input name="cstSimples" defaultValue={editing?.cstSimples ?? ""} maxLength={3} className="font-mono" /></Field>
              <Field label="CST padrão (regime normal)" hint="Vazio = do grupo."><Input name="cstNormal" defaultValue={editing?.cstNormal ?? ""} maxLength={2} className="font-mono" /></Field>
            </FormGrid>
            <Checkbox name="active" label="Ativa (disponível no assistente da NF-e)" defaultChecked={editing?.active ?? true} />
            <div className="flex justify-end gap-2">
              <Link href="/fiscal/configuracoes?tab=operacoes" className={buttonClass("ghost")}>Fechar</Link>
              {submit("Salvar natureza")}
            </div>
          </ActionForm>
        </Card>
      )}
      {tcOn && (
        <Card title="Tributação completa — DIFAL, PIS/COFINS e alíquotas por UF" description="DIFAL na venda interestadual a consumidor final não contribuinte (EC 87/2015): por fora (base única) ou por dentro (base dupla), conforme a legislação da UF de destino. A alíquota interna do destino vem do grupo tributário ou desta tabela.">
          <ActionForm action={saveCompleteSettingsAction} className="space-y-3">
            <FormGrid cols={3}>
              <Field label="Modo padrão do DIFAL"><Select name="difalDefaultMode" defaultValue={difalDefault === "dentro" ? "dentro" : "fora"} options={Object.entries(DIFAL_MODE_LABEL).map(([value, label]) => ({ value, label }))} /></Field>
              <Field label="Modo por UF" hint="Uma por linha: “MG dentro”, “SP fora”."><Textarea name="difalModes" defaultValue={formatDifalModes(difalModes as Record<string, "fora" | "dentro">)} rows={3} className="font-mono" /></Field>
              <Field label="Alíquotas internas por UF" hint="UF alíquota [FCP] [MVA ajustada] — ex.: “RJ 20 2”. O grupo tributário sobrepõe."><Textarea name="ufRates" defaultValue={formatUfRates(ufRates as any)} rows={3} className="font-mono" /></Field>
            </FormGrid>
            <Checkbox name="pisCofinsExcludeIcms" label="Excluir o ICMS próprio da base do PIS e da COFINS (regime normal — tema 69 do STF)" defaultChecked={Boolean(pisCofins)} />
            {canEdit && <div className="flex justify-end gap-2">{discard}{submit("Salvar opções")}</div>}
          </ActionForm>
        </Card>
      )}
      {credOn && (
        <Card title="Crédito do Simples Nacional (CSOSN 101 e 201)" description="Alíquota do Anexo da LC 123/2006 correspondente à faixa de receita do mês anterior (art. 23, § 2º) — atualize todo mês. A NF-e leva pCredSN/vCredICMSSN e a mensagem do crédito nas informações complementares.">
          <ActionForm action={saveSimplesCreditAction} className="space-y-3">
            <FormGrid cols={3}>
              <Field label="Percentual de crédito (pCredSN, %)"><Input name="simplesCredit" inputMode="decimal" defaultValue={credit ? String(credit / 100).replace(".", ",") : ""} placeholder="2,56" /></Field>
            </FormGrid>
            {!simples && <p className="text-xs text-amber-700">A empresa não está no Simples Nacional: o crédito não é calculado.</p>}
            {canEdit && <div className="flex justify-end gap-2">{discard}{submit("Salvar percentual")}</div>}
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
