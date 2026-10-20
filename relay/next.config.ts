import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // rotas da ponte são dinâmicas por natureza (fila em memória/RTDB)
  // firebase-admin só carrega quando PONTE_BACKEND=firebase — e bundlar SDK
  // do Google dentro do build do Next dá conflito de deps nativas; external
  // deixa o runtime resolver direto do node_modules.
  serverExternalPackages: ['firebase-admin'],
};

export default nextConfig;
