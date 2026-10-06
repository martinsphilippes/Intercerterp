import type { MetadataRoute } from "next";

/** Manifesto do app (PWA): instalável no celular, tablet e computador. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Intercert ERP",
    short_name: "Intercert",
    description: "ERP Intercert para comércio e varejo — PDV, estoque, financeiro, compras e fiscal.",
    lang: "pt-BR",
    dir: "ltr",
    start_url: "/dashboard?origem=app",
    scope: "/",
    display: "standalone",
    display_override: ["window-controls-overlay", "standalone", "minimal-ui"],
    orientation: "any",
    background_color: "#0f2147",
    theme_color: "#0f2147",
    categories: ["business", "finance", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
    shortcuts: [
      { name: "Frente de caixa (PDV)", short_name: "PDV", url: "/pdv", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Painel do gestor", short_name: "Painel", url: "/dashboard", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Produtos", short_name: "Produtos", url: "/produtos", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Contas a receber", short_name: "Receber", url: "/financeiro/receber", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
