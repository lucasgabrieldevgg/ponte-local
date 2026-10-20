// POST /api/ponte/cmd — a IA web (operador) enfileira um comando.
// Header x-ponte-token = OPERATOR token do canal (o que viaja no bloco).
// No original a auth era x-ponte-admin com ADMIN_TOKEN fixo de env; aqui o
// canal nasce do POST /pair (adaptado pro app GalaxyCut, spec t30 §7).
// Body: { action, args? } — cap 64 KB (comandos do editor são pequenos;
// o cap de 12 MB do original servia ao write_binary, que não existe aqui).
import { NextRequest } from 'next/server';
import { addCommand, canalPorOperador } from '@/lib/ponte-store';

export const dynamic = 'force-dynamic';
const MAX_BODY = 64_000;

export async function POST(req: NextRequest) {
  const token = req.headers.get('x-ponte-token');
  const canal = canalPorOperador(token);
  if (canal === null) {
    return Response.json(
      { ok: false, error: 'token de operador inválido' },
      { status: 401 },
    );
  }
  const raw = await req.text();
  if (raw.length > MAX_BODY) {
    return Response.json({ ok: false, error: 'comando maior que 64 KB' }, { status: 413 });
  }
  let body: { action?: string; args?: Record<string, unknown> };
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ ok: false, error: 'JSON inválido' }, { status: 400 });
  }
  if (!body.action || typeof body.action !== 'string') {
    return Response.json({ ok: false, error: 'Falta a ação' }, { status: 400 });
  }
  try {
    const cmd = addCommand(canal, body.action, body.args);
    return Response.json({ ok: true, id: cmd.id });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : 'Erro ao enfileirar' },
      { status: 429 },
    );
  }
}
