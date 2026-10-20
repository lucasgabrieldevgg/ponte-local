// Ponte Local — GalaxyCut — estado compartilhado do relay (memória do processo).
//
// ADAPTAÇÃO do relay do ponte-local (MIT © 2026 MicaelSanPedro / @micsxnn):
//   https://github.com/micsxnn/ponte-local
// O desenho do transporte é DELE e foi preservado: lease de 120 s no poll,
// fresh-skip no primeiro poll (sem cursor), fila bounded, histórico capado,
// seq monotônica, estado em globalThis (HMR-safe). O que MUDOU nesta
// adaptação: os tokens fixos por variável de ambiente viraram CANAIS
// DINÂMICOS — o app GalaxyCut gera o par (agente, operador) na hora do
// pareamento e registra no relay via POST /api/ponte/pair, porque o token
// de operador viaja no bloco colável e o de agente nunca sai do app
// (spec t30 §7 da casa). Um canal novo com o mesmo token REVOGA o anterior
// na hora; canal sem poll por 6 h expira sozinho.
//
// t42: este módulo é a implementação MEMÓRIA da interface PonteBackend
// (src/lib/backend.ts) — a bateria do verify-relay roda idêntica nela e na
// implementação Firebase. As funções abaixo continuam sendo a fonte da
// verdade do desenho original; o wrapper createMemoryBackend() só adapta
// a assinatura ao contrato.
//
// Privacidade (herdada do original): nada de arquivos trafega aqui — apenas
// JSON de metadados/operações do editor.

import type { PonteBackend, PonteCommand, PonteResult } from './backend';

export type { PonteCommand, PonteResult } from './backend';

interface Canal {
  agentToken: string;
  operatorToken: string;
  commands: PonteCommand[];
  results: PonteResult[];
  /** id do comando → timestamp do claim (entrega exclusiva, molde original). */
  claimed: Map<number, number>;
  /** último poll do agente (epoch ms) — alimenta o TTL do canal. */
  lastSeenAgent: number;
  createdAt: number;
  totalCommands: number;
  totalResults: number;
}

interface Estado {
  seq: number;
  /** agentToken → canal (o app polla por aqui). */
  canaisAgente: Map<string, Canal>;
  /** operatorToken → canal (a IA web posta comandos por aqui). */
  canaisOperador: Map<string, Canal>;
  startedAt: number;
  totalPairs: number;
}

const g = globalThis as unknown as { __ponteGalaxycutRelay?: Estado };

export const PONTE_VERSION = "2.1.0-galaxycut";
export const CONNECTED_WINDOW_MS = 15_000;

/** Lease do claim: se o app não responder em 2 min, o comando volta pra fila. */
const CLAIM_LEASE_MS = 120_000;
/** Canal sem poll do agente por 6 h expira (relay público não vira depósito). */
const CANAL_TTL_MS = 6 * 60 * 60_000;
const MAX_CANAIS = 500;
const MAX_PENDING = 100; // original
const MAX_RESULTS = 400; // original
const MAX_COMMANDS_HIST = 500; // original
const MAX_RESULTS_SLICE = 100; // original

/** Formato dos tokens da casa (protocol.ts — Web Crypto, 36 hex). */
const TOKEN_RE = /^gcpt_[0-9a-f]{36}$/;

export function estado(): Estado {
  if (!g.__ponteGalaxycutRelay) {
    g.__ponteGalaxycutRelay = {
      seq: 0,
      canaisAgente: new Map(),
      canaisOperador: new Map(),
      startedAt: Date.now(),
      totalPairs: 0,
    };
  }
  const s = g.__ponteGalaxycutRelay;
  // Defesa contra HMR/estados antigos em memória (molde original)
  if (!(s.canaisAgente instanceof Map)) s.canaisAgente = new Map();
  if (!(s.canaisOperador instanceof Map)) s.canaisOperador = new Map();
  return s;
}

function expiraCanaisMortos(s: Estado): void {
  const now = Date.now();
  for (const canal of [...s.canaisAgente.values()]) {
    if (now - canal.lastSeenAgent > CANAL_TTL_MS) {
      s.canaisAgente.delete(canal.agentToken);
      s.canaisOperador.delete(canal.operatorToken);
    }
  }
}

/**
 * POST /api/ponte/pair — registra o par (agentToken, operatorToken) gerado
 * PELO APP. Um canal novo que reutilize qualquer um dos dois tokens
 * SUBSTITUI o anterior na hora (re-pareamento revoga, P1 da spec da casa).
 */
export function registerPair(
  agentToken: unknown,
  operatorToken: unknown,
): { ok: true } | { ok: false; error: string } {
  if (typeof agentToken !== "string" || typeof operatorToken !== "string") {
    return { ok: false, error: "agentToken e operatorToken são obrigatórios (strings)" };
  }
  if (TOKEN_RE.test(agentToken) !== true) {
    return { ok: false, error: "agentToken inválido — formato esperado: gcpt_ + 36 hex" };
  }
  if (TOKEN_RE.test(operatorToken) !== true) {
    return { ok: false, error: "operatorToken inválido — formato esperado: gcpt_ + 36 hex" };
  }
  const s = estado();
  expiraCanaisMortos(s);
  if (s.canaisAgente.size >= MAX_CANAIS) {
    return { ok: false, error: "Relay cheio (limite de canais) — use um self-host: github.com/lucasgabrieldevgg/ponte-local" };
  }
  // re-pareamento: qualquer token reutilizado mata o canal anterior NA HORA
  const velhoAgente = s.canaisAgente.get(agentToken);
  const velhoOperador = s.canaisOperador.get(operatorToken);
  for (const velho of [velhoAgente, velhoOperador]) {
    if (velho !== undefined) {
      s.canaisAgente.delete(velho.agentToken);
      s.canaisOperador.delete(velho.operatorToken);
    }
  }
  const canal: Canal = {
    agentToken,
    operatorToken,
    commands: [],
    results: [],
    claimed: new Map(),
    lastSeenAgent: Date.now(),
    createdAt: Date.now(),
    totalCommands: 0,
    totalResults: 0,
  };
  s.canaisAgente.set(agentToken, canal);
  s.canaisOperador.set(operatorToken, canal);
  s.totalPairs += 1;
  return { ok: true };
}

export function canalPorAgente(token: string | null): Canal | null {
  if (!token) return null;
  return estado().canaisAgente.get(token) ?? null;
}

export function canalPorOperador(token: string | null): Canal | null {
  if (!token) return null;
  return estado().canaisOperador.get(token) ?? null;
}

export function markSeen(canal: Canal): void {
  canal.lastSeenAgent = Date.now();
}

export function addCommand(canal: Canal, action: string, args?: Record<string, unknown>): PonteCommand {
  const s = estado();
  const pending = canal.commands.filter(
    (c) => !canal.results.some((r) => r.id === c.id),
  );
  if (pending.length >= MAX_PENDING) {
    throw new Error("Fila de comandos cheia (o app não está respondendo?)");
  }
  s.seq += 1;
  canal.totalCommands += 1;
  const cmd: PonteCommand = { id: s.seq, action, args: args ?? {}, ts: Date.now() };
  canal.commands.push(cmd);
  if (canal.commands.length > MAX_COMMANDS_HIST) {
    canal.commands = canal.commands.slice(-MAX_COMMANDS_HIST);
  }
  return cmd;
}

export function pollCommands(
  canal: Canal,
  cursor: number,
): { commands: PonteCommand[]; nextCursor: number } {
  const now = Date.now();
  const pending = canal.commands.filter((c) => {
    if (c.id <= cursor) return false;
    if (canal.results.some((r) => r.id === c.id)) return false;
    const claimedAt = canal.claimed.get(c.id);
    if (claimedAt && now - claimedAt < CLAIM_LEASE_MS) return false;
    return true;
  });
  for (const c of pending) canal.claimed.set(c.id, now);
  if (canal.claimed.size > 500) {
    for (const [id, t] of canal.claimed) {
      if (now - t > CLAIM_LEASE_MS) canal.claimed.delete(id);
    }
  }
  const maxId = canal.commands.length ? canal.commands[canal.commands.length - 1].id : cursor;
  return { commands: pending, nextCursor: Math.max(maxId, cursor) };
}

export function maxCommandId(canal: Canal): number {
  return canal.commands.length ? canal.commands[canal.commands.length - 1].id : 0;
}

export function pushResult(canal: Canal, r: PonteResult): void {
  canal.totalResults += 1;
  canal.results.push(r);
  if (canal.results.length > MAX_RESULTS) canal.results = canal.results.slice(-MAX_RESULTS);
}

export function resultsSince(canal: Canal, since: number): PonteResult[] {
  return canal.results.filter((r) => r.id > since).slice(0, MAX_RESULTS_SLICE);
}

/**
 * GET /api/ponte/status — público e SEM segredos: este relay é multi-canal,
//  então nada de estado por canal aqui (nem contagem de pendentes). Só a
// saúde do relay. O painel do APP mostra o estado do SEU pareamento lendo
// o próprio poll — a fonte da verdade do canal é o app, não o relay.
 */
export function stats() {
  const s = estado();
  return {
    ok: true as const,
    version: PONTE_VERSION,
    relay: "galaxycut-ponte",
    canaisAtivos: s.canaisAgente.size,
    totalPareamentos: s.totalPairs,
    uptimeS: Math.round((Date.now() - s.startedAt) / 1000),
  };
}

/* ------------------------------------------------------------------ */
/* t42 — adaptador da interface PonteBackend (contrato de backend.ts).   */
/* As funções acima continuam sendo a fonte da verdade do desenho        */
/* original; nada de lógica nova aqui, só tradução de assinatura.        */
/* ------------------------------------------------------------------ */

export function createMemoryBackend(): PonteBackend {
  return {
    async registerPair(agentToken, operatorToken) {
      const r = registerPair(agentToken, operatorToken);
      return r.ok === true ? { ok: true } : { ok: false, status: 400, error: r.error };
    },

    async poll(agentToken, cursor) {
      const canal = canalPorAgente(agentToken);
      if (canal === null) return { ok: false, status: 401 };
      markSeen(canal);
      if (cursor === null) {
        return { ok: true, commands: [], nextCursor: maxCommandId(canal), fresh: true };
      }
      const { commands, nextCursor } = pollCommands(canal, cursor);
      return { ok: true, commands, nextCursor, fresh: false };
    },

    async addResult(agentToken, result) {
      const canal = canalPorAgente(agentToken);
      if (canal === null) return { ok: false, status: 401 };
      pushResult(canal, { ...result, ts: Date.now() });
      return { ok: true };
    },

    async addCommand(operatorToken, action, args) {
      const canal = canalPorOperador(operatorToken);
      if (canal === null) return { ok: false, status: 401 };
      try {
        const cmd = addCommand(canal, action, args);
        return { ok: true, id: cmd.id };
      } catch (e) {
        return { ok: false, status: 429, error: e instanceof Error ? e.message : 'Erro ao enfileirar' };
      }
    },

    async resultsSince(operatorToken, since) {
      const canal = canalPorOperador(operatorToken);
      if (canal === null) return { ok: false, status: 401 };
      const results = resultsSince(canal, since);
      const lastId = results.length ? results[results.length - 1].id : since;
      return { ok: true, results, lastId };
    },

    async stats() {
      const s = stats();
      return {
        ok: true as const,
        canaisAtivos: s.canaisAtivos,
        totalPareamentos: s.totalPareamentos,
        uptimeS: s.uptimeS,
      };
    },
  };
}
