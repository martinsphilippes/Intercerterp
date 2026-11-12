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
