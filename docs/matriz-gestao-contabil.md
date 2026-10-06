# Matriz de cobertura — Gestão contábil (escritórios de contabilidade)

Fonte: prompt "Módulo completo para escritórios contábeis" (18 menus, 25 seções + 13 do complemento), analisado item a item em
`docs/analise-gestao-contabil.md` (87 itens). Esta matriz registra o que está **implementado de verdade** (persistido, testado, navegável) e o que
fica para as próximas fases — sem estado fictício. Regras adotadas: `docs/regras-assumidas.md` §21.

Decisões do dono que moldaram a fase 0: produto vendido a **vários escritórios** (cada escritório é uma empresa do tipo `accounting`, isolada);
o **cliente contábil é cadastro próprio do escritório** (PF ou PJ, com ou sem ERP); quando o cliente usa o Intercert ERP, o vínculo é por
**código de consentimento** aceito pela empresa — a partir daí XMLs, situação fiscal e pacotes mensais chegam sozinhos ao escritório.

Legenda: **Implementada** = persistida, com regra de negócio no domínio, teste automatizado e tela navegável; **Fase N** = planejada
(ver roteiro ao fim); **—** = não se aplica.

## Telas da fase 0

| Nº | Tela | Rota(s) | Perfis | Domínio (`src/domain/accounting`) | Validação (testes / navegador) | Situação | Observações e decisões |
|---|---|---|---|---|---|---|---|
| C01 | Painel da carteira | /contabil | firm_admin, firm_manager, firm_analyst, firm_finance | `portfolioOverview` (queries), `linkedSnapshot` | tests/accounting.test.ts (carteira restrita); varredura como contador e analista | Implementada | Indicadores calculados dos registros: clientes por situação e regime, vínculos ativos, entregas a revisar, pendências (sem responsável, em implantação, vínculo pendente); situação fiscal das empresas vinculadas em somente leitura. Usuário de empresa operacional é redirecionado ao /dashboard. |
| C02 | Clientes contábeis (lista) | /contabil/clientes | todos do escritório (carteira restrita ao analista) | `listClients`/`visibleClientIds`, exportação `src/exports/accounting.ts` | testes de unicidade por escritório, isolamento e carteira restrita; navegador | Implementada | Filtros por situação, regime, tipo, serviço, grupo, responsável e busca por nome/CPF/CNPJ/código; totais do recorte; exportação CSV com o mesmo filtro. |
| C03 | Cadastro de cliente contábil | /contabil/clientes/novo, /contabil/clientes/[id]/editar | firm_admin, firm_manager (edit) | `createClient`, `updateClient`, `lookupClientCnpj`, `suggestRegime` | teste "cadastra PJ com código sequencial…"; navegador (consulta de CNPJ real na BrasilAPI) | Implementada | PF/PJ condicional; consulta de CNPJ traz CNAEs, natureza, porte, abertura, situação na RFB, Simples/MEI e QSA; sugestão de regime; código C0001 sequencial por escritório; CPF/CNPJ único por escritório; CNPJ não muda enquanto houver vínculo. |
| C04 | Cliente 360° | /contabil/clientes/[id] (abas) | todos com visibilidade do cliente | `getClient`, `clientRegimeHistory`, `listPeople`, `listEstablishments`, `listAssignments`, `companyAccountingLink`, `linkedSnapshot`, `listDeliveries` | testes de regime com vigência, transições de situação, sócios ≤ 100 %, raiz do CNPJ, vínculo, somente leitura; navegador | Implementada | Abas: dados, regime (histórico com vigência), pessoas (sócios/contatos/representantes), estabelecimentos, equipe responsável, vínculo com o ERP (gerar/cancelar código, revogar), situação fiscal da empresa vinculada (meses, obrigações, certificados, documentos travados) e entregas recebidas. |
| C05 | Grupos de clientes | /contabil/grupos | firm_admin, firm_manager | `listGroups`, `saveGroup` | navegador | Implementada | Grupo econômico/familiar/comercial; contagem de clientes por grupo; cliente pertence a um grupo. |
| C06 | Departamentos e equipe | /contabil/equipe | firm_admin, firm_manager (accounting.manage_team) | `listDepartments`, `saveDepartment`, `setDepartmentMember`, `assignResponsible`, `endAssignment` | teste de carteira restrita (responsável, titular/substituto, gestor do departamento); navegador | Implementada | Departamentos padrão: fiscal, contábil, pessoal, societário, financeiro (BPO); gestor × membro; titular único por departamento e cliente; a visibilidade do analista deriva daqui. |
| C07 | Caixa de entrada (entregas) | /contabil/entregas | todos com visibilidade do cliente | `listDeliveries`, `reviewDelivery`, `deliveryForFile` | teste "pacote mensal … entra na caixa de entrada (idempotente)"; download por `/api/files/[id]` auditado (`delivery.download`) | Implementada | Pacotes mensais (XMLs + relatórios) entregues automaticamente pela empresa vinculada; marcar como revisado (com desfazer); filtros por cliente, competência e situação. |
| C08 | Vínculo com o escritório (lado da empresa) | /administracao/integracoes (cartão "Contabilidade") | admin da empresa (admin.integrations) | `acceptAccountingLink`, `revokeAccountingLink`, `companyAccountingLink` | teste "código de vínculo: aceite exige CNPJ coincidente, código válido e não expirado"; "desfazer o vínculo preserva entregas"; navegador | Implementada | A empresa informa o código recebido do escritório; CNPJ deve coincidir; um escritório por empresa; revogação a qualquer momento pela empresa ou pelo escritório; envio do pacote passa a entregar na caixa do escritório mesmo sem e-mail configurado. |

## Menus do prompt × situação

| Menu do prompt | Fase 0 (esta entrega) | Próxima fase |
|---|---|---|
| 1 Painel | Painel da carteira (C01) com indicadores reais | Fase 1: obrigações da carteira, trabalhos atrasados, SLA |
| 2 Clientes | Cadastro completo, 360°, grupos, pessoas, estabelecimentos, regime com vigência, situação (C02–C05) | Fase 1: documentos por cliente; Fase 3: portal |
| 3 Comercial | — | Fase 4: propostas, funil, implantação |
| 4 Contratos e honorários | Catálogo de serviços (lista fixa por cliente) | Fase 2: contratos, reajuste, faturamento recorrente |
| 5 Financeiro do escritório | Contas, categorias e meios do escritório (parametrização enxuta) | Fase 2: honorários → contas a receber, NFS-e de honorários, cobrança |
| 6 Obrigações e calendário | Situação fiscal da empresa vinculada em leitura (C04) | Fase 1: calendário por regime/cliente, geração automática, baixa com evidência |
| 7 Trabalho e tarefas | Departamentos, responsáveis titular/substituto (C06) | Fase 1: trabalhos recorrentes, checklists, revisão em 2 níveis |
| 8 Documentos e arquivo | Caixa de entrada de pacotes (C07) com download auditado | Fase 1: arquivo por cliente/competência/tipo, cobrança de faltantes |
| 9 Atendimento e SLA | — | Fase 3 |
| 10 Portal do cliente | — | Fase 3 |
| 11 BPO financeiro | Departamento "financeiro (BPO)" previsto | Fase 5 |
| 12 Equipe, horas e capacidade | Membros por departamento, carteira por responsável | Fase 4: horas, capacidade, rentabilidade |
| 13 Integrações e importações | Vínculo por consentimento com o Intercert ERP (XMLs, situação fiscal, pacotes) | Fase 5: importação de XML/OFX de clientes sem ERP, outros ERPs |
| 14 Certidões, certificados e procurações | Certificados da empresa vinculada em leitura (vencimento) | Fase 1: certidões com renovação, procurações |
| 15 Relatórios | Exportação da carteira (CSV) | Fase 1+: relatórios por fase |
| 16 IA e consistência | Sugestão de regime na consulta de CNPJ | Fase 5 |
| 17 Configurações | Perfis do escritório (firm_admin/manager/analyst/finance), departamentos, grupos | Fase 2: catálogo de serviços editável, modelos de contrato |
| 18 Auditoria e segurança | Toda ação auditada (`accounting.*`, `delivery.download`); isolamento por escritório; leitura de outra empresa só via vínculo e somente leitura | — |

## Roteiro das próximas fases (resumo; detalhe em `docs/analise-gestao-contabil.md`)

1. **Obrigações e trabalho**: calendário de obrigações por regime e cliente, trabalhos recorrentes com checklist, revisão, documentos por competência, cobrança de faltantes.
2. **Receita do escritório**: contratos, honorários e reajustes, faturamento recorrente, NFS-e de honorários, cobrança e inadimplência.
3. **Relacionamento**: portal do cliente, atendimento com SLA, comunicação por e-mail/WhatsApp.
4. **Gestão**: horas, capacidade, rentabilidade por cliente, comercial e implantação.
5. **Escala**: BPO financeiro, regularidade (certidões/procurações), importações de clientes sem ERP, IA (classificação e alertas).

Identidade visual INTEROS: aguarda os ativos (logotipo, paleta, tipografia) do dono; a área contábil usa a paleta atual do sistema.
