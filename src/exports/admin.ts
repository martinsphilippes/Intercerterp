import "server-only";
import { defineExport } from "@/lib/exporters";
import { parseList } from "@/lib/list";
import { queryUsers, queryRoles } from "@/app/(app)/administracao/usuarios/queries";
import { queryAudit } from "@/app/(app)/administracao/historico/queries";
import { queryCompanies, queryBranches } from "@/app/(app)/administracao/empresas/queries";
import { queryTerminals } from "@/app/(app)/administracao/terminais/queries";
import { queryBackups, INTEGRITY_LABEL } from "@/app/(app)/administracao/backups/queries";
import { ticketsFor } from "@/app/(app)/ajuda/chamados/queries";
import { queryNotifications, TYPE_LABEL } from "@/domain/notifications";
import { TICKET_CATEGORIES } from "@/domain/support";

defineExport("admin.users", {
  module: "admin",
  title: "Usuários",
  columns: [
    { key: "name", label: "Nome" },
    { key: "email", label: "E-mail" },
    { key: "login", label: "Login" },
    { key: "roleName", label: "Perfil" },
    { key: "branchesLabel", label: "Filiais" },
    { key: "effectiveDiscountBps", label: "Desconto máximo (%)", type: "bps" },
    { key: "discountSource", label: "Origem do limite" },
    { key: "statusKey", label: "Situação" },
    { key: "firstAccessAt", label: "Primeiro acesso", type: "datetime" },
    { key: "lastAccessAt", label: "Último acesso", type: "datetime" },
    { key: "inviteExpiresAt", label: "Convite expira", type: "datetime" },
    { key: "suspendedReason", label: "Motivo da suspensão" },
  ],
  rows: (s, params) => queryUsers(s.ctx, parseList(params)),
});

defineExport("admin.roles", {
  module: "admin",
  title: "Perfis",
  columns: [
    { key: "name", label: "Perfil" },
    { key: "description", label: "Descrição" },
    { key: "modules", label: "Módulos visíveis", type: "number" },
    { key: "writes", label: "Módulos com alteração", type: "number" },
    { key: "actions", label: "Operações específicas", type: "number" },
    { key: "discountLimitBps", label: "Desconto máximo (%)", type: "bps" },
    { key: "usersCount", label: "Usuários", type: "number" },
  ],
  rows: (s) => queryRoles(s.ctx),
});

defineExport("admin.audit", {
  module: "admin",
  title: "Histórico e auditoria",
  columns: [
    { key: "code", label: "Evento" },
    { key: "occurredAt", label: "Data/hora", type: "datetime" },
    { key: "userName", label: "Responsável" },
    { key: "userRole", label: "Perfil no momento" },
    { key: "moduleLabel", label: "Módulo" },
    { key: "action", label: "Ação" },
    { key: "entityLabel", label: "Registro" },
    { key: "entityId", label: "Id do registro" },
    { key: "summary", label: "Resumo" },
    { key: "reason", label: "Motivo" },
    { key: "result", label: "Resultado" },
    { key: "ip", label: "IP" },
  ],
  rows: (s, params) => queryAudit(s.ctx, parseList(params)),
});

defineExport("admin.companies", {
  module: "admin",
  title: "Empresas",
  columns: [
    { key: "name", label: "Razão social" },
    { key: "tradeName", label: "Nome fantasia" },
    { key: "cnpj", label: "CNPJ" },
    { key: "regimeLabel", label: "Regime" },
    { key: "crt", label: "CRT" },
    { key: "city", label: "Município" },
    { key: "branchesCount", label: "Unidades", type: "number" },
    { key: "usersCount", label: "Usuários vinculados", type: "number" },
    { key: "status", label: "Situação" },
  ],
  rows: (s, params) => queryCompanies(s, parseList(params)),
});

defineExport("admin.branches", {
  module: "admin",
  title: "Unidades (filiais)",
  columns: [
    { key: "code", label: "Código" },
    { key: "name", label: "Unidade" },
    { key: "kind", label: "Tipo" },
    { key: "cnpj", label: "CNPJ" },
    { key: "ie", label: "IE" },
    { key: "city", label: "Cidade / UF" },
    { key: "cityCode", label: "Município IBGE" },
    { key: "managerName", label: "Responsável" },
    { key: "priceTableName", label: "Tabela de preço padrão" },
    { key: "warehouseName", label: "Depósito padrão" },
    { key: "timezone", label: "Fuso" },
    { key: "terminalsCount", label: "Terminais", type: "number" },
    { key: "situation", label: "Situação" },
  ],
  rows: (s, params) => queryBranches(s, params.empresa && s.companies.some((c) => c.id === params.empresa) ? String(params.empresa) : s.ctx.companyId, parseList(params)),
});

defineExport("admin.terminals", {
  module: "admin",
  title: "Terminais do PDV",
  columns: [
    { key: "code", label: "Código" },
    { key: "name", label: "Terminal" },
    { key: "branchName", label: "Filial" },
    { key: "status", label: "Situação" },
    { key: "nfceSeries", label: "Série NFC-e", type: "number" },
    { key: "printerLabel", label: "Impressão" },
    { key: "printerName", label: "Impressora" },
    { key: "paperWidth", label: "Papel (mm)", type: "number" },
    { key: "scannerLabel", label: "Leitor" },
    { key: "tefLabel", label: "Cartão/TEF" },
    { key: "connectorUrl", label: "Conector" },
    { key: "warehouseName", label: "Depósito de saída" },
    { key: "sessionOperator", label: "Operador do caixa aberto" },
    { key: "sessionOpenedAt", label: "Caixa aberto desde", type: "datetime" },
    { key: "lastPrinterTestAt", label: "Último teste", type: "datetime" },
    { key: "lastPrinterTestResult", label: "Resultado do último teste" },
  ],
  rows: (s, params) => queryTerminals(s.ctx, parseList(params)),
});

defineExport("admin.backups", {
  module: "admin",
  title: "Cópias de segurança",
  columns: [
    { key: "code", label: "Identificação" },
    { key: "startedAt", label: "Início", type: "datetime" },
    { key: "finishedAt", label: "Conclusão", type: "datetime" },
    { key: "originLabel", label: "Origem" },
    { key: "requestedBy", label: "Solicitado por" },
    { key: "rows", label: "Registros", type: "number" },
    { key: "files", label: "Arquivos", type: "number" },
    { key: "sizeBytes", label: "Tamanho (bytes)", type: "number" },
    { key: "status", label: "Situação" },
    { key: "integrityLabel", label: "Integridade" },
    { key: "checksum", label: "Checksum dos dados" },
    { key: "retentionUntil", label: "Retida até", type: "date" },
  ],
  rows: async (s, params) => (await queryBackups(s.ctx, parseList(params))).map((b) => ({ ...b, integrityLabel: INTEGRITY_LABEL[b.integrity as keyof typeof INTEGRITY_LABEL] })),
});

defineExport("support.tickets", {
  module: "support",
  title: "Chamados",
  columns: [
    { key: "number", label: "Número", type: "number" },
    { key: "subject", label: "Assunto" },
    { key: "requester", label: "Solicitante" },
    { key: "categoryLabel", label: "Categoria" },
    { key: "priority", label: "Prioridade" },
    { key: "status", label: "Situação" },
    { key: "createdAt", label: "Aberto em", type: "datetime" },
    { key: "lastMessageAt", label: "Última movimentação", type: "datetime" },
    { key: "resolvedAt", label: "Resolvido em", type: "datetime" },
    { key: "origin", label: "Origem" },
  ],
  rows: async (s, params) => (await ticketsFor(s.ctx, parseList(params))).map((t) => ({ ...t, categoryLabel: TICKET_CATEGORIES.find((c) => c.value === t.category)?.label ?? t.category, origin: t.isPublic ? "Tela de login" : "ERP" })),
});

defineExport("notifications", {
  module: "dashboard",
  title: "Notificações",
  columns: [
    { key: "createdAt", label: "Data/hora", type: "datetime" },
    { key: "typeLabel", label: "Área" },
    { key: "priority", label: "Prioridade" },
    { key: "title", label: "Título" },
    { key: "occurrenceStatus", label: "Situação na origem" },
    { key: "responsibleName", label: "Responsável na origem" },
    { key: "readAt", label: "Lida em", type: "datetime" },
    { key: "link", label: "Origem" },
  ],
  rows: async (s, params) => (await queryNotifications(s.ctx, { type: params.type as string, view: params.view as string, branch: params.branch as string, from: params.from as string, to: params.to as string, q: params.q as string, occ: params.occ as any })).map((n) => ({ ...n, typeLabel: TYPE_LABEL[n.type] ?? n.type })),
});
