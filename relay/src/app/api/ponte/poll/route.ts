// GET /api/ponte/poll?cursor=N — o app GalaxyCut pergunta "tem comando?".
// Header x-ponte-token = AGENT token do canal (nunca sai do app).
// Semântica HERDADA do original: primeiro poll SEM cursor → fresh=true e o
// backlog antigo é PULADO (nada de sessão passada executa de surpresa);
// claim com lease de 120 s (app morto → comando volta pra fila).
import { NextRequest } from 'next/server';
import { canalPorAgente, markSeen, maxCommandId, pollCommands, PONTE_VERSION } from '@/lib/ponte-store';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const token = req.headers.get('x-ponte-token');
  const canal = canalPorAgente(token);
  if (canal === null) {
    return Response.json(
      { ok: false, error: 'token de agente inválido ou pareamento expirado' },
      { status: 401 },
    );
  }
  markSeen(canal);
  const url = new URL(req.url);

  // primeiro poll: pula o histórico (fresh, molde original)
  if (!url.searchParams.has('cursor')) {
    return Response.json(
      {
        ok: true,
        commands: [],
        nextCursor: maxCommandId(canal),
        fresh: true,
        pollMs: 1500,
        version: PONTE_VERSION,
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  }

  const cursor = Math.max(0, parseInt(url.searchParams.get('cursor') ?? '0', 10) || 0);
  const { commands, nextCursor } = pollCommands(canal, cursor);
  return Response.json(
    { ok: true, commands, nextCursor, pollMs: 1500, version: PONTE_VERSION },
    { headers: { 'cache-control': 'no-store' } },
  );
}
