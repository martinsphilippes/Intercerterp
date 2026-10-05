import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["node-appwrite"],
  experimental: { serverActions: { bodySizeLimit: "10mb" } },
};

export default nextConfig;
