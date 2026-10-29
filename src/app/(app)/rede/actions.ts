"use server";

import { headers } from "next/headers";
import { runAction, fstr, fopt, fbool, fint } from "@/lib/server/action";
import { requireFeature } from "@/lib/server/features";
import {
  createNode, moveNode, setNodeStatus, saveLevelLabels, saveNodePriceRule, saveLevelPriceRule, clearNodePriceRule, isLevel, type NetworkLevel, type NodeStatus, type PriceRuleInput,
} from "@/domain/network";
import { BusinessError } from "@/lib/core/errors";

const PATHS = ["/rede", "/rede/minha", "/rede/precos", "/rede/parametros", "/contabil"];

async function requestOrigin() {
  if (process.env.APP_URL) return process.env.APP_URL;
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
}

function level(v: string): NetworkLevel {
  if (!isLevel(v)) throw new BusinessError("Escolha o nível.", "level");
  return v;
}

export async function createNodeAction(fd: FormData) {
  return runAction({ module: "dashboard", revalidate: PATHS }, async (s) => {
    await requireFeature(s, "redeCertificacao");
    const mode = fstr(fd, "mode");
    const r = await createNode(s.ctx, {
      parentNodeId: fopt(fd, "parentNodeId"), level: level(fstr(fd, "level")),
      linkCnpj: mode === "link" ? fopt(fd, "linkCnpj") : null,
      company: mode === "link" ? null : { name: fstr(fd, "name"), tradeName: fopt(fd, "tradeName"), cnpj: fopt(fd, "cnpj"), email: fopt(fd, "email"), phone: fopt(fd, "phone"), address: { cityName: fstr(fd, "cityName"), cityCode: fstr(fd, "cityCode"), uf: fstr(fd, "uf") } },
      admin: mode === "link" ? null : { name: fstr(fd, "adminName"), email: fstr(fd, "adminEmail"), login: fopt(fd, "adminLogin") },
      cityName: fopt(fd, "cityName"), uf: fopt(fd, "uf"), region: fopt(fd, "region"), commercialResponsible: fopt(fd, "commercialResponsible"), notes: fopt(fd, "notes"),
      origin: await requestOrigin(),
    });
    const invite = r.invite ? (r.invite.delivered ? ` Convite enviado por e-mail a ${fstr(fd, "adminEmail")}.` : ` O e-mail do convite não foi enviado: copie o link no histórico de Usuários da empresa nova ou reenvie (${r.invite.link}).`) : "";
    return { ok: true as const, data: { id: r.node.id }, message: `${r.node.name} (${r.node.code}) ${r.linked ? "vinculado" : "cadastrado"} na rede.${invite}`, redirect: `/rede/${r.node.id}` };
  });
}

export async function moveNodeAction(fd: FormData) {
  return runAction({ module: "dashboard", revalidate: PATHS }, async (s) => {
    await requireFeature(s, "redeCertificacao");
    const parent = fstr(fd, "parentNodeId");
    await moveNode(s.ctx, fstr(fd, "id"), { parentNodeId: parent === "__platform" ? null : parent || null, reason: fstr(fd, "reason") });
    return { ok: true as const, message: "Parceiro movido; o caminho dele e dos parceiros abaixo foi recalculado." };
  });
}

export async function setNodeStatusAction(fd: FormData) {
  return runAction({ module: "dashboard", revalidate: PATHS }, async (s) => {
    await requireFeature(s, "redeCertificacao");
    const status = fstr(fd, "status") as NodeStatus;
    await setNodeStatus(s.ctx, fstr(fd, "id"), status, fopt(fd, "reason"));
    return { ok: true as const, message: status === "active" ? "Parceiro reativado." : status === "suspended" ? "Parceiro suspenso." : "Parceiro encerrado." };
  });
}

export async function saveLevelLabelsAction(fd: FormData) {
  return runAction({ module: "dashboard", revalidate: PATHS }, async (s) => {
    await requireFeature(s, "redeCertificacao");
    await saveLevelLabels(s.ctx, { master: fstr(fd, "master"), regional: fstr(fd, "regional"), revenda: fstr(fd, "revenda"), contador: fstr(fd, "contador") });
    return { ok: true as const, message: "Rótulos dos níveis salvos." };
  });
}

function ruleInput(fd: FormData): PriceRuleInput {
  return { productKey: fstr(fd, "productKey"), cost: fint(fd, "cost", -1), minPrice: fint(fd, "minPrice", -1), defaultPrice: fint(fd, "defaultPrice", -1), canEdit: fbool(fd, "canEdit"), validFrom: fopt(fd, "validFrom"), reason: fopt(fd, "reason") };
}

/** Preço de um filho (exceção) ou da tabela padrão por nível (dono = nó ou plataforma). */
export async function savePriceRuleAction(fd: FormData) {
  return runAction({ module: "dashboard", revalidate: PATHS }, async (s) => {
    await requireFeature(s, "redeCertificacao");
    const target = fstr(fd, "target");
    if (target === "node") await saveNodePriceRule(s.ctx, fstr(fd, "nodeId"), ruleInput(fd));
    else await saveLevelPriceRule(s.ctx, fopt(fd, "ownerNodeId"), level(fstr(fd, "level")), ruleInput(fd));
    return { ok: true as const, message: "Preço salvo (a regra anterior foi encerrada na véspera da vigência e continua no histórico)." };
  });
}

export async function clearNodePriceRuleAction(fd: FormData) {
  return runAction({ module: "dashboard", revalidate: PATHS }, async (s) => {
    await requireFeature(s, "redeCertificacao");
    await clearNodePriceRule(s.ctx, fstr(fd, "nodeId"), fstr(fd, "productKey"), fopt(fd, "reason"));
    return { ok: true as const, message: "Exceção retirada: vale a tabela padrão do parceiro acima." };
  });
}
