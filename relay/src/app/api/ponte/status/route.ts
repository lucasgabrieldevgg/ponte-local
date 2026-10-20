// GET /api/ponte/status — público e SEM segredos. Multi-canal = zero estado
// por canal aqui (privacidade: nem contagem de pendentes de um canal
// específico vaza). O painel do APP mostra o estado do pareamento lendo o
// próprio poll — a fonte da verdade do canal é o app.
// t42: números vêm do backend escolhido (memória | Firebase RTDB) — no
// Firebase, canaisAtivos é a contagem do último sweep (aproximação
// documentada; varrer todos os canais a cada /status seria caro).
import { getBackend } from '@/lib/backend';
import { PONTE_VERSION } from '@/lib/ponte-store';

export const dynamic = 'force-dynamic';

export async function GET() {
  const backend = await getBackend();
  const s = await backend.stats();
  return Response.json(
    {
      ok: true,
      version: PONTE_VERSION,
      relay: 'galaxycut-ponte',
      canaisAtivos: s.canaisAtivos,
      totalPareamentos: s.totalPareamentos,
      uptimeS: s.uptimeS,
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
