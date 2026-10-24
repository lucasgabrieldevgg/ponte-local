// POST /api/ponte/result — o app devolve o resultado de UM comando.
// Header x-ponte-token = AGENT token. Resultado não-confirmado entra na
// fila do app e é reenviado antes do próximo poll (relayClient da casa).
// t42: estado no backend escolhido (memória | Firebase RTDB).
import { NextRequest } from 'next/server';
import { getBackend } from '@/lib/backend';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const token = req.headers.get('x-ponte-token');
  let body: { id?: unknown; ok?: unknown; data?: unknown; error?: unknown; durationMs?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: 'JSON inválido' }, { status: 400 });
  }
  if (typeof body.id !== 'number' || typeof body.ok !== 'boolean') {
    return Response.json(
      { ok: false, error: 'resultado precisa de {id, ok, data?|error?}' },
      { status: 400 },
    );
  }
  const backend = await getBackend();
  const r = await backend.addResult(token, {
    id: body.id,
    ok: body.ok,
    data: body.data,
    error: typeof body.error === 'string' ? body.error : undefined,
    durationMs: typeof body.durationMs === 'number' ? body.durationMs : undefined,
  });
  if (r.ok !== true) {
    return Response.json({ ok: false, error: 'token de agente inválido' }, { status: 401 });
  }
  return Response.json({ ok: true });
}
