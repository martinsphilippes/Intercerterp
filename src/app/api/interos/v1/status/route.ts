import { serviceRoute, API_VERSION } from "@/lib/service/http";
import { SERVICE_SCOPES } from "@/lib/service/credentials";

export const dynamic = "force-dynamic";

/** Saúde da interface de serviço e identificação da credencial (para o Interos testar a configuração). */
export const GET = serviceRoute({ scope: [...SERVICE_SCOPES], operation: "status" }, async (call) => ({
  body: { situacao: "ok", versao: API_VERSION, cliente: { id: call.client.id, nome: call.client.nome, familia: call.client.familia, escopos: call.client.escopos, empresas: call.client.empresas, assinaturaExigida: call.client.assinatura.length > 0 }, horarioServidor: new Date().toISOString(), requestId: call.requestId },
}));
