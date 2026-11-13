import { postgresUrl } from "../db/postgres/driver";

/**
 * Publicação (Vercel) sem banco configurado: em vez de cair silenciosamente numa demonstração em memória
 * (volátil e inconsistente entre instâncias sem estado), a aplicação mostra o que falta configurar.
 * A demonstração em memória continua disponível de forma explícita com DATA_BACKEND=memory.
 *
 * O banco é o Postgres conectado ao projeto na Vercel (`DATABASE_URL`). Instalação antiga no Appwrite continua
 * valendo enquanto as três variáveis dele existirem; com parte delas, o aviso lista as que faltam.
 */
export const REQUIRED_APPWRITE_ENV = ["APPWRITE_ENDPOINT", "APPWRITE_PROJECT_ID", "APPWRITE_API_KEY"] as const;

export function missingDeploymentConfig(): string[] {
  if (!process.env.VERCEL || process.env.DATA_BACKEND) return [];
  if (postgresUrl()) return [];
  const appwrite = REQUIRED_APPWRITE_ENV.filter((k) => !process.env[k]);
  if (!appwrite.length) return [];
  return appwrite.length === REQUIRED_APPWRITE_ENV.length ? ["DATABASE_URL"] : appwrite;
}

/**
 * Região das funções da Vercel → região equivalente do provedor de nuvem (é como os bancos se identificam).
 * As funções rodam na região fixada em `vercel.json` ("regions"); o banco, na região escolhida ao criá-lo.
 */
const VERCEL_TO_CLOUD_REGION: Record<string, string> = {
  arn1: "eu-north-1", bom1: "ap-south-1", cdg1: "eu-west-3", cle1: "us-east-2", cpt1: "af-south-1", dub1: "eu-west-1", dxb1: "me-central-1",
  fra1: "eu-central-1", gru1: "sa-east-1", hkg1: "ap-east-1", hnd1: "ap-northeast-1", iad1: "us-east-1", icn1: "ap-northeast-2", kix1: "ap-northeast-3",
  lhr1: "eu-west-2", pdx1: "us-west-2", sfo1: "us-west-1", sin1: "ap-southeast-1", syd1: "ap-southeast-2", yul1: "ca-central-1",
};

/**
 * As funções rodam na mesma região do banco? Uma tela faz várias consultas em sequência e cada uma paga a distância
 * (Frankfurt ↔ São Paulo: ~200 ms por consulta; mesma região: 1 a 3 ms). `null` quando não dá para saber (fora da
 * Vercel, região desconhecida ou banco sem região no endereço).
 */
export function functionsNearDatabase(functionRegion: string | null | undefined, dbRegion: string | null | undefined): boolean | null {
  const cloud = VERCEL_TO_CLOUD_REGION[String(functionRegion ?? "").toLowerCase()];
  if (!cloud || !dbRegion) return null;
  return cloud === dbRegion.toLowerCase();
}

/** Código da região da Vercel que fica junto de uma região do provedor (para a orientação do diagnóstico). */
export function vercelRegionFor(dbRegion: string | null | undefined): string | null {
  const wanted = String(dbRegion ?? "").toLowerCase();
  return Object.entries(VERCEL_TO_CLOUD_REGION).find(([, cloud]) => cloud === wanted)?.[0] ?? null;
}
