# Política de segurança da modularização

Vale para o catálogo v1 em runtime e para a camada v2 proposta.

## Recursos que nunca podem ser desligados comercialmente (CORE)

- Autenticação, segunda etapa e sessão.
- Isolamento por empresa (`ScopedStore`).
- Auditoria (`audit_logs`).
- Backup e restauração.
- Administração essencial: usuários, perfis, empresas e filiais, parâmetros.
- Download de documentos já emitidos.
- Ciclo de vida legal de documentos fiscais já criados: transmitir, consultar, cancelar no prazo, CC-e e contingência.
- Obrigações em curso (política `drain`).

No catálogo, essas entradas têm `classification: platform` (v1) ou `CORE` (v2). A API recusa alterá-las com `not_contractable`.

## Onde a validação acontece

O controle não se resume a esconder menu.

| Camada | Ponto de controle | Situação |
|---|---|---|
| Interface | Menu dinâmico, `featureOn`, aviso de consulta | ✅ v1 |
| Rotas e links diretos | `requireSession`, pelo caminho real do middleware | ✅ v1 |
| Backend (server actions) | `runAction({ entitlement })` nas 392 ações | ✅ v1 |
| APIs internas e exportações | `requireApiSession({ modules })` e o módulo da chave | ✅ v1 |
| Rotinas e segundo plano | `runScheduled` conforme o módulo; fila nunca bloqueada | ✅ v1 |
| Webhooks de terceiros | Processados só para registros existentes (obrigação) | ✅ v1 |
| Páginas públicas | Loja fora do ar ou em pausa conforme o módulo | ✅ v1 |
| Banco de dados | Isolamento por `companyId`. Sem Row Level Security: o acesso ao banco é só do servidor. | ✅ (sem RLS; o banco nunca é exposto ao navegador) |
| Aplicativos externos | Não existem hoje. Quando existirem, usarão as mesmas APIs com conferência de módulo. | ⏳ |
| Limites contratados (usuários, dispositivos, filiais) | `src/domain/licensing/limits.ts`, chamado nos cadastros e reativações | ✅ v2 (fiscal só avisa) |

## Credenciais

- Escritas da v2 exigem HMAC (`X-Interos-Signature`), com segredo por credencial indicado em `assinatura` (`INTEROS_CREDENCIAIS`), e `X-Interos-Event-Id` único (anti-repetição por 7 dias). A credencial pode ser restrita a uma lista de empresas (`companyIds`).
- Tokens do Interos ficam só no servidor (`INTEROS_CREDENCIAIS`, registro único das três APIs, guarda apenas o hash SHA-256 do segredo; `docs/interos/credenciais.md`). Nunca vão para o navegador.
- O segredo da assinatura de eventos é separado do token; cada cliente tem o seu.
- Rotação sem janela de indisponibilidade: cadastrar a nova credencial, trocar no Interos e remover a antiga.
- Integrações de terceiros guardam só o nome da variável de ambiente, nunca o valor (padrão existente da Central de integrações).

## Separação entre contratação e permissão

- O Interos decide o que a empresa contratou. O perfil decide o que cada usuário pode fazer dentro do que foi contratado.
- O administrador da empresa não consegue habilitar módulos para si: a alteração só vem pela API do Interos ou por um administrador da plataforma, com ator e motivo registrados.
- **Implementado (decisão 8):**
  - cargo, departamento e função são atributos do usuário que aplicam o perfil pela regra `access.attributeRoles`;
  - o perfil continua sendo o único contêiner de permissões, para evitar duas fontes de verdade;
  - permissões granulares (visualizar, cadastrar, editar, excluir, executar, aprovar, cancelar, importar, exportar, imprimir, administrar) entram como operações do perfil por submódulo.

## Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Bloquear cliente atual por erro de mapeamento | Linha de base em `legacy` → `shadow` (só registra) → `enforced`, com revisão de divergências |
| Retrato de licença antigo sobrescrever um novo | `licenseVersion` monotônico (v2); `If-Match` e índice único de versão (v1) |
| Repetição de evento | `Event-Id` único com janela de tempo e HMAC (v2); `Idempotency-Key` (v1) |
| Interos fora do ar | Cópia local, rotinas locais para datas e carência antes do modo consulta |
| Obrigação legal interrompida | Política `drain`, motor fiscal como CORE e `ALWAYS_RUN_ROUTINES` |
