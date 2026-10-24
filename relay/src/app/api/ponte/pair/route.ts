// POST /api/ponte/pair — o app GalaxyCut registra aqui o par de tokens que
// ELE gerou (spec t30 §7): agentToken fica no app, operatorToken viaja no
// bloco colável. Reusar qualquer dos tokens num par novo revoga o canal
// anterior na hora. ADAPTAÇÃO GalaxyCut — no original os tokens eram env
// vars fixas; aqui são canais dinâmicos com TTL e limites.
// t42: o estado mora no backend escolhido (memória | Firebase RTDB).
import { NextRequest } from 'next/server';
import { getBackend } from '@/lib/backend';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  let body: { agentToken?: unknown; operatorToken?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: 'JSON inválido' }, { status: 400 });
  }
  const backend = await getBackend();
  const r = await backend.registerPair(body.agentToken, body.operatorToken);
  if (r.ok !== true) {
    return Response.json({ ok: false, error: r.error }, { status: 400 });
  }
  return Response.json({ ok: true });
}
