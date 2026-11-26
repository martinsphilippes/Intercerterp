import { serviceRoute } from "@/lib/service/http";
import { linkExistingTenant } from "@/domain/tenancy/provisioning";
import { actorOf } from "../../_lib";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // literal: o Next lê a configuração da rota sem executar o código

/** Vincula uma empresa que já usa o ERP (ID ERP + CNPJ + código de vínculo gerado pelo administrador dela). */
export const POST = serviceRoute({ scope: "provisionamento:escrita", operation: "empresas.vincular", mutation: true, newCompany: true }, async (call) => {
  const out = await linkExistingTenant(call.store, actorOf(call), call.body);
  return { status: out.status, companyId: out.view.idEmpresa, body: { empresa: out.view } };
});
