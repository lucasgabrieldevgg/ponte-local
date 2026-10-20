// GET /api/ponte/status — público e SEM segredos. Multi-canal = zero estado
// por canal aqui (privacidade: nem contagem de pendentes de um canal
// específico vaza). O painel do APP mostra o estado do pareamento lendo o
// próprio poll — a fonte da verdade do canal é o app.
import { stats } from '@/lib/ponte-store';

export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json(stats(), { headers: { 'cache-control': 'no-store' } });
}
