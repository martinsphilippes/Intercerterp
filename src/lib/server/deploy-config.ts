/**
 * Publicação (Vercel) sem o Appwrite configurado: em vez de cair silenciosamente numa demonstração em memória
 * (volátil e inconsistente entre instâncias sem estado), a aplicação mostra o que falta configurar.
 * A demonstração em memória continua disponível de forma explícita com DATA_BACKEND=memory.
 */
export const REQUIRED_APPWRITE_ENV = ["APPWRITE_ENDPOINT", "APPWRITE_PROJECT_ID", "APPWRITE_API_KEY"] as const;

export function missingDeploymentConfig(): string[] {
  if (!process.env.VERCEL || process.env.DATA_BACKEND) return [];
  return REQUIRED_APPWRITE_ENV.filter((k) => !process.env[k]);
}
