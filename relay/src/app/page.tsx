'use client';

// Painel do relay — MÍNIMO E HONESTO (o painel do original mostrava o bloco
// de instalação do agente de PC; aqui o pareamento nasce NO APP, então o
// painel só diz que o relay está vivo e quantos canais existem. ZERO
// segredos na tela: nem tokens, nem ações, nem nomes de projetos).
import { useEffect, useState } from 'react';

interface Status {
  ok: boolean;
  version: string;
  canaisAtivos: number;
  totalPareamentos: number;
  uptimeS: number;
}

export default function Painel() {
  const [st, setSt] = useState<Status | null>(null);

  useEffect(() => {
    const load = () => fetch('/api/ponte/status').then((r) => r.json()).then(setSt).catch(() => setSt(null));
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  return (
    <main className="min-h-screen bg-[#0d1117] text-[#e6edf3] flex items-center justify-center p-6">
      <div className="w-full max-w-xl space-y-4">
        <div className="flex items-center gap-3">
          <span className={`w-3 h-3 rounded-full ${st ? 'bg-emerald-500' : 'bg-amber-500'} animate-pulse`} />
          <h1 className="text-lg font-semibold">Relay da Ponte — GalaxyCut-AI</h1>
        </div>
        <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-4 text-sm space-y-1.5 font-mono">
          <div>versão: {st ? st.version : '…'}</div>
          <div>canais ativos: {st ? st.canaisAtivos : '…'}</div>
          <div>uptime: {st ? `${Math.floor(st.uptimeS / 60)} min` : '…'}</div>
        </div>
        <p className="text-xs leading-relaxed text-[#8b949e]">
          Este é o relay do Modo Ponte: a IA que você usa (Claude, ChatGPT, Gemini…) opera o editor GalaxyCut
          do seu computador pelo chat. Para parear, use o painel <b>Modo Ponte</b> dentro do app — ele gera o
          bloco com este endereço e o token, pronto pra colar no chat da sua IA.
        </p>
        <p className="text-xs text-[#8b949e] border-t border-[#21262d] pt-3">
          Transporte adaptado do{' '}
          <a className="text-[#58a6ff] hover:underline" href="https://github.com/micsxnn/ponte-local" target="_blank" rel="noreferrer">
            ponte-local de MicaelSanPedro
          </a>{' '}
          (MIT © 2026) — o desenho da fila (lease, fresh, cursor) é dele. Fork mantido pelo{' '}
          <a className="text-[#58a6ff] hover:underline" href="https://github.com/lucasgabrieldevgg" target="_blank" rel="noreferrer">
            projeto GalaxyCut-AI
          </a>
          .
        </p>
      </div>
    </main>
  );
}
