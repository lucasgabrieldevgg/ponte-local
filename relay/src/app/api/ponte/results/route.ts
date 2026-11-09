// GET /api/ponte/results?since=N — a IA web lê os resultados dos comandos
// que ela enfileirou. Header x-ponte-token = OPERATOR token (o do bloco).
// Contrato da skill da casa: {ok, results, lastId, hasMore} — o lastId é o
// próximo cursor `since` da IA; o hasMore avisa que existem resultados
// DEPOIS desta página (página de 100). Sem o hasMore a paginação mentia em
// silêncio e a IA achava que o histórico tinha sumido.
// t42: estado no backend escolhido (memória | Firebase RTDB).
import { NextRequest } from 'next/server';
import { getBackend } from '@/lib/backend';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const token = req.headers.get('x-ponte-token');
  const url = new URL(req.url);
  const since = Math.max(0, parseInt(url.searchParams.get('since') ?? '0', 10) || 0);
  const backend = await getBackend();
  const r = await backend.resultsSince(token, since);
  if (r.ok !== true) {
    return Response.json({ ok: false, error: 'token de operador inválido' }, { status: 401 });
  }
  return Response.json(
    { ok: true, results: r.results, lastId: r.lastId, hasMore: r.hasMore },
    { headers: { 'cache-control': 'no-store' } },
  );
}
