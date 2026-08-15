import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Existe um package-lock.json solto em C:\Users\PICHAU; sem isto o Turbopack
  // sobe a árvore procurando a raiz do workspace e avisa a cada boot.
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
