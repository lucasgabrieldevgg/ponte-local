// CORS para as rotas da ponte: o painel do app GalaxyCut (renderer, origem
// file://) registra o pareamento com POST /pair direto do navegador — sem
// isto o fetch do painel morre antes de chegar ao relay. A IA web posta
// /cmd de processo próprio (curl/fetch de servidor — sem CORS envolvido).
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
  if (req.method === 'OPTIONS') {
    return new NextResponse(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, x-ponte-token',
        'Access-Control-Max-Age': '86400',
      },
    });
  }
  const res = NextResponse.next();
  res.headers.set('Access-Control-Allow-Origin', '*');
  return res;
}

export const config = { matcher: '/api/ponte/:path*' };
