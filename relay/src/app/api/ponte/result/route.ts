// POST /api/ponte/result — o app devolve o resultado de UM comando.
// Header x-ponte-token = AGENT token. Resultado não-confirmado entra na
// fila do app e é reenviado antes do próximo poll (relayClient da casa).
import { NextRequest } from 'next/server';
import { canalPorAgente, pushResult } from '@/lib/ponte-store';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const token = req.headers.get('x-ponte-token');
  const canal = canalPorAgente(token);
  if (canal === null) {
    return Response.json(
      { ok: false, error: 'token de agente inválido ou pareamento expirado' },
      { status: 401 },
    );
  }
  let body: { id?: number; ok?: boolean; data?: unknown; error?: string; durationMs?: number };
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
  pushResult(canal, {
    id: body.id,
    ok: body.ok,
    data: body.data,
    error: body.error,
    durationMs: body.durationMs,
    ts: Date.now(),
  });
  return Response.json({ ok: true });
}
