# Evolução do Intercert ERP (referência GDoor) — documentação

Estudo aprovado em outubro/2026 e executado por fases, cada uma em branch própria, com testes de caracterização,
recursos novos atrás de parâmetro (`feature.*`, lido por `isFeatureOn`) e publicação em produção somente após aprovação.

| Documento | Conteúdo |
|---|---|
| `01-gdoor-funcionalidades.md` | Inventário funcional do GDoor a partir da base de conhecimento pública (sem código, marcas ou imagens) |
| `02-intercert-auditoria.md` | Auditoria do Intercert ERP: telas, módulos, regras, evidências |
| `03-matriz-comparativa.md` | Matriz A–F (existe igual / melhor / parcial / ausente / não se aplica / decidir) |
| `04-ausentes.md` | Funcionalidades ausentes com valor de negócio |
| `05-nao-duplicar.md` | O que reaproveitar e ampliar em vez de criar |
| `06-design.md` | Opções de design e a escolhida (C — híbrida) |
| `08-logica-negocio.md` | Regras de negócio das funcionalidades novas |
| `09-plano.md` | Plano por fases (0 a 8 + trilha de periféricos) |
| `10-riscos.md` | Riscos, mitigação e limitações do estudo |
| `inventario-fiscal-documents.md` | Fase 0: leitores de `fiscal_documents` e decisão revista da escrituração de entradas |

## Andamento

| Fase | Branch | Situação |
|---|---|---|
| 0 — base de segurança | `feat/fase-0-baseline` | testes de caracterização dos cálculos, `isFeatureOn`, regra "venda em caixa de outro operador" (parâmetro `cash.operatorMismatch`), inventário fiscal |
