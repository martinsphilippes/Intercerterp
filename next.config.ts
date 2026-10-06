import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pasta de build alternativa (ex.: servidor de desenvolvimento em paralelo ao de produção)
  distDir: process.env.NEXT_DIST_DIR || ".next",
  serverExternalPackages: ["node-appwrite"],
  // fuso da instalação também no navegador: datas formatadas iguais no servidor e no cliente (sem erro de hidratação)
  env: { APP_TIMEZONE: process.env.APP_TIMEZONE || "America/Sao_Paulo" },
  experimental: { serverActions: { bodySizeLimit: "10mb" } },
};

export default nextConfig;
