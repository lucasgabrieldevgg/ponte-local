// GET /api/ponte/results?since=N — a IA web lê os resultados dos comandos
// que ela enfileirou. Header x-ponte-token = OPERATOR token (o do bloco).
// Contrato da skill da casa: {ok, results, lastId} — o lastId é o próximo
// cursor `since` da IA.
import { NextRequest } from 'next/server';
import { canalPorOperador, resultsSince } from '@/lib/ponte-store';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const token = req.headers.get('x-ponte-token');
  const canal = canalPorOperador(token);
  if (canal === null) {
    return Response.json({ ok: false, error: 'token de operador inválido' }, { status: 401 });
  }
  const url = new URL(req.url);
  const since = Math.max(0, parseInt(url.searchParams.get('since') ?? '0', 10) || 0);
  const results = resultsSince(canal, since);
  const lastId = results.length ? results[results.length - 1].id : since;
  return Response.json(
    { ok: true, results, lastId },
    { headers: { 'cache-control': 'no-store' } },
  );
}
