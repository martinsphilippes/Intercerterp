import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pasta de build alternativa (ex.: servidor de desenvolvimento em paralelo ao de produção)
  distDir: process.env.NEXT_DIST_DIR || ".next",
  serverExternalPackages: ["node-appwrite"],
  // fuso da instalação também no navegador: datas formatadas iguais no servidor e no cliente (sem erro de hidratação)
  env: { APP_TIMEZONE: process.env.APP_TIMEZONE || "America/Sao_Paulo" },
  experimental: { serverActions: { bodySizeLimit: "10mb" } },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
    ];
  },
};

export default nextConfig;
