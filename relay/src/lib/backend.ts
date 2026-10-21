// Ponte Local — GalaxyCut — fachada de backend do relay (t42).
//
// O relay nasceu com estado em MEMÓRIA de processo (ponte-store, molde do
// ponte-local de MicaelSanPedro / @micsxnn, MIT © 2026 — desenho preservado).
// Em serverless a instância recicla e a memória zera: o app se recupera
// sozinho (o /pair do próximo Conectar re-registra), mas comandos em voo se
// perdem. A t42 adiciona persistência REAL sem quebrar o desenho original:
//
//   PONTE_BACKEND=memory    (default) — fila em memória, zero config, self-host
//   PONTE_BACKEND=firebase  — estado no Firebase RTDB via Admin SDK
//                             (FIREBASE_SERVICE_ACCOUNT + FIREBASE_DATABASE_URL)
//
// O CONTRATO é o mesmo para as duas implementações (verify-relay roda a mesma
// bateria nos dois backends). Regras do banco: LOCKED admin-only — o Admin SDK
// ignora regras, clientes públicos não leem/escrevem nada.

/* ------------------------------------------------------------------ */
/* Tipos base do transporte (nascem AQUI; ponte-store re-exporta)        */
/* ------------------------------------------------------------------ */

export interface PonteCommand {
  id: number;
  action: string;
  args?: Record<string, unknown>;
  ts: number;
}

export interface PonteResult {
  id: number;
  ok: boolean;
  data?: unknown;
  error?: string;
  durationMs?: number;
  ts: number;
}

/* ------------------------------------------------------------------ */
/* DTOs do contrato (status HTTP embutido — as rotas só traduzem)       */
/* ------------------------------------------------------------------ */

export type RegisterPairOutcome =
  | { ok: true }
  | { ok: false; status: 400; error: string };

export type PollOutcome =
  | { ok: true; commands: PonteCommand[]; nextCursor: number; fresh: boolean; skipped?: number }
  | { ok: false; status: 401 };
// [t44] skipped (só no fresh): quantos comandos PENDENTES o fresh-skip
// pulou — o relay confessa o backlog descartado em vez de silenciar
// (achado do A3 na revisão t40; cosmético, o cursor já protege).

export type AddResultOutcome =
  | { ok: true }
  | { ok: false; status: 401 };

export type AddCommandOutcome =
  | { ok: true; id: number }
  | { ok: false; status: 401 }
  | { ok: false; status: 429; error: string };

export type ResultsSinceOutcome =
  | { ok: true; results: PonteResult[]; lastId: number }
  | { ok: false; status: 401 };

export type StatsOutcome = {
  ok: true;
  canaisAtivos: number;
  totalPareamentos: number;
  uptimeS: number;
};

export interface PonteBackend {
  /** POST /pair — registra o par gerado PELO APP; reuso de token revoga. */
  registerPair(agentToken: unknown, operatorToken: unknown): Promise<RegisterPairOutcome>;
  /** GET /poll — cursor null = primeiro poll (fresh-skip, molde original). */
  poll(agentToken: string | null, cursor: number | null): Promise<PollOutcome>;
  /** POST /result — o app devolve o resultado de UM comando. */
  addResult(
    agentToken: string | null,
    result: { id: number; ok: boolean; data?: unknown; error?: string; durationMs?: number },
  ): Promise<AddResultOutcome>;
  /** POST /cmd — a IA web enfileira; 429 quando a fila está cheia. */
  addCommand(
    operatorToken: string | null,
    action: string,
    args?: Record<string, unknown>,
  ): Promise<AddCommandOutcome>;
  /** GET /results?since — a IA web lê os resultados (lastId = próximo since). */
  resultsSince(operatorToken: string | null, since: number): Promise<ResultsSinceOutcome>;
  /** GET /status — público, SEM segredos. */
  stats(): Promise<StatsOutcome>;
}

/* ------------------------------------------------------------------ */
/* Factory — singleton HMR-safe (async: firebase-admin só carrega se    */
/* pedido — o backend memória não paga o cold start da SDK)             */
/* ------------------------------------------------------------------ */

const g = globalThis as unknown as { __ponteBackendChoice?: Promise<PonteBackend> };

export async function getBackend(): Promise<PonteBackend> {
  const escolhido = (process.env.PONTE_BACKEND ?? 'memory').trim().toLowerCase();
  if (escolhido === 'memory') {
    const memory = await import('./ponte-store');
    return memory.createMemoryBackend();
  }
  if (escolhido === 'firebase') {
    if (g.__ponteBackendChoice === undefined) {
      g.__ponteBackendChoice = import('./firebase-backend').then((fb) => fb.createFirebaseBackend());
    }
    return g.__ponteBackendChoice;
  }
  throw new Error(`PONTE_BACKEND inválido: "${escolhido}" (use "memory" ou "firebase")`);
}
