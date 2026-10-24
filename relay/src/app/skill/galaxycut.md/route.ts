// GET /skill/galaxycut.md [t49] — a skill do Modo Ponte, servida pelo relay.
//
// O bloco de pareamento do app manda a IA ler {relay}/skill/galaxycut.md
// (protocol.ts PONTE_SKILL_PATH). Antes desta rota o relay só tinha
// /api/ponte/* — a URL nascia 404 e a IA ficava sem o manual.
//
// Conteúdo: MÓDULO GERADO (src/lib/galaxycut-skill.ts, regenerado por
// `npm run gen:skill` a partir do SKILL.md raiz do fork — fluxo t44).
// ZERO fs em runtime: a constante entra no bundle, à prova de serverless.
// Three-way (d4): bloco do app = docs do app = SKILL.md fork = rota servida.
//
// Content-Type EXPLÍCITO — não confiamos no mime mágico de plataforma
// nenhuma: text/markdown; charset=utf-8, do jeito que a diretriz pediu.
import { GALAXYCUT_SKILL_MD } from '@/lib/galaxycut-skill';

export const dynamic = 'force-static';

export function GET() {
  return new Response(GALAXYCUT_SKILL_MD, {
    status: 200,
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
}
