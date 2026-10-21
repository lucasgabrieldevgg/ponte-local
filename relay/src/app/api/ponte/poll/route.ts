// GET /api/ponte/poll?cursor=N — o app GalaxyCut pergunta "tem comando?".
// Header x-ponte-token = AGENT token do canal (nunca sai do app).
// Semântica HERDADA do original: primeiro poll SEM cursor → fresh=true e o
// backlog antigo é PULADO (nada de sessão passada executa de surpresa);
// claim com lease de 120 s (app morto → comando volta pra fila).
// t42: o canal mora no backend escolhido (memória | Firebase RTDB) — a
// reciclagem da instância serverless NÃO expira mais o pareamento.
import { NextRequest } from 'next/server';
import { getBackend } from '@/lib/backend';
import { PONTE_VERSION } from '@/lib/ponte-store';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const token = req.headers.get('x-ponte-token');
  const url = new URL(req.url);
  const temCursor = url.searchParams.has('cursor');

  const backend = await getBackend();
  const cursor = temCursor
    ? Math.max(0, parseInt(url.searchParams.get('cursor') ?? '0', 10) || 0)
    : null;
  const r = await backend.poll(token, cursor);
  if (r.ok !== true) {
    return Response.json(
      { ok: false, error: 'token de agente inválido ou pareamento expirado' },
      { status: 401 },
    );
  }
  if (r.fresh) {
    return Response.json(
      {
        ok: true,
        commands: [],
        nextCursor: r.nextCursor,
        fresh: true,
        // [t44] quantos pendentes o fresh-skip pulou (0 quando o canal nasce
        // limpo) — transparência para o app/IA reenviar o que importa.
        skipped: r.skipped ?? 0,
        pollMs: 1500,
        version: PONTE_VERSION,
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  }
  return Response.json(
    { ok: true, commands: r.commands, nextCursor: r.nextCursor, pollMs: 1500, version: PONTE_VERSION },
    { headers: { 'cache-control': 'no-store' } },
  );
}
