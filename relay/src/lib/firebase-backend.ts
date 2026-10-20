// Ponte Local — GalaxyCut — backend Firebase RTDB da t42.
//
// Por que este arquivo existe: o relay original (molde do ponte-local de
// MicaelSanPedro / @micsxnn, MIT © 2026) guarda os canais em MEMÓRIA de
// processo. Em serverless (Vercel) a instância recicla e a memória zera: o
// app se recupera sozinho (o /pair do próximo Conectar re-registra o canal),
// mas um comando em voo se perde e todo pareamento ativo "expira" junto com
// a instância. Este backend move o estado pro Firebase RTDB do projeto da
// casa (galaxy-ponte) via Admin SDK — as regras do banco ficam LOCKED
// (admin-only): o Admin SDK as ignora, e nenhum cliente público lê ou
// escreve nada diretamente no banco. Toda a conversa continua passando pelo
// relay HTTP, exatamente como no desenho original.
//
// Semântica HERDADA (o contrato é o mesmo do backend memória — o verify
// roda a mesma bateria nos dois):
//   • fresh-skip no primeiro poll (sem cursor): backlog antigo é PULADO
//   • claim com lease de 120 s: app morto → comando volta pra fila
//   • re-pareamento com token reutilizado REVOGA o canal anterior na hora
//   • canal sem poll por 6 h expira (sweep oportunista, rate-limitado)
//   • fila bounded (MAX_PENDING), resultados por página (MAX_RESULTS_SLICE)
//   • separação §7: agentToken só polla/devolve, operatorToken só enfileira/lê
//
// Formato no banco (root default ''; o verify usa um root de teste):
//   {root}/canais/{agentToken}        = { operatorToken, createdAt, lastSeenAgent, totalCommands, totalResults, pendingCount }
//   {root}/indexOperador/{operatorToken} = { agentToken }
//   {root}/cmds/{agentToken}/{pad10}  = { id, action, args, ts, claimedAt?, doneAt? }
//   {root}/results/{agentToken}/{pad10} = { id, ok, data?, error?, durationMs?, ts }
//   {root}/meta/{seq,totalPairs,canaisAtivos,lastSweep}
//
// Detalhe fino: as chaves dos comandos/resultados são ids com zero-pad de
// 10 dígitos porque o RTDB ordena chaves LEXICOGRAFICAMENTE ("10" < "9") —
// o pad faz a ordem lexicográfica coincidir com a numérica até 9.999.999.999.
//
// Limitações honestas (v1):
//   • stats().canaisAtivos vem do último sweep (aproximação, não contagem
//     em tempo real — varrer todos os canais a cada /status seria caro).
//   • Dois registerPair simultâneos com tokens cruzados podem correr entre
//     a leitura e o update atômico (multi-path). Caso caseiro, raro, e a
//     revogação ainda prevalece no próximo pareamento.
import { getApp, getApps, initializeApp, cert, type App } from 'firebase-admin/app';
import { getDatabase, ServerValue } from 'firebase-admin/database';
import type {
  AddCommandOutcome,
  AddResultOutcome,
  PollOutcome,
  PonteBackend,
  RegisterPairOutcome,
  ResultsSinceOutcome,
  StatsOutcome,
} from './backend';

/* Constantes — espelham o backend memória (ponte-store) */
const CLAIM_LEASE_MS = 120_000;
const CANAL_TTL_MS = 6 * 60 * 60_000;
const MAX_CANAIS = 500;
const MAX_PENDING = 100;
const MAX_RESULTS_SLICE = 100;
const MAX_CMD_FETCH = 120;
const SWEEP_INTERVAL_MS = 5 * 60_000;

/** Formato dos tokens da casa (protocol.ts do app — Web Crypto, 36 hex). */
const TOKEN_RE = /^gcpt_[0-9a-f]{36}$/;

const pad = (id: number): string => String(id).padStart(10, '0');
const nowMs = (): number => Date.now();

/* ------------------------------------------------------------------ */
/* App Admin (singleton HMR-safe)                                        */
/* ------------------------------------------------------------------ */

const g = globalThis as unknown as { __ponteFbApp?: App };

function adminApp(): App {
  const saRaw = process.env.FIREBASE_SERVICE_ACCOUNT;
  const dbUrl = process.env.FIREBASE_DATABASE_URL;
  if (g.__ponteFbApp === undefined) {
    if (!saRaw || !dbUrl) {
      throw new Error(
        'PONTE_BACKEND=firebase exige FIREBASE_SERVICE_ACCOUNT (JSON da service account) ' +
          'e FIREBASE_DATABASE_URL (ex.: https://SEU-PROJETO-default-rtdb.firebaseio.com)',
      );
    }
    let sa: Record<string, unknown>;
    try {
      sa = JSON.parse(saRaw) as Record<string, unknown>;
    } catch {
      throw new Error('FIREBASE_SERVICE_ACCOUNT não é um JSON válido');
    }
    g.__ponteFbApp =
      getApps().length > 0
        ? getApp()
        : initializeApp({ credential: cert(sa), databaseURL: dbUrl });
  }
  return g.__ponteFbApp;
}

/* ------------------------------------------------------------------ */
/* Registro do canal                                                     */
/* ------------------------------------------------------------------ */

interface CanalRow {
  operatorToken: string;
  createdAt: number;
  lastSeenAgent: number;
  totalCommands: number;
  totalResults: number;
  pendingCount: number;
}

/** Remove canais mortos (6 h sem poll) e atualiza meta/canaisAtivos. */
async function sweep(root: string): Promise<number> {
  const db = getDatabase(adminApp());
  const base = db.ref(root);
  const metaSnap = await base.child('meta/lastSweep').get();
  const last = metaSnap.val() as number | null;
  const agora = nowMs();
  if (last !== null && typeof last === 'number' && agora - last < SWEEP_INTERVAL_MS) {
    const aprox = (await base.child('meta/canaisAtivos').get()).val();
    return typeof aprox === 'number' ? aprox : 0;
  }
  const canaisSnap = await base.child('canais').get();
  const updates: Record<string, unknown> = { 'meta/lastSweep': agora };
  let vivos = 0;
  if (canaisSnap.exists()) {
    for (const [agentToken, val] of Object.entries(canaisSnap.val() as Record<string, CanalRow>)) {
      const lastSeen = typeof val?.lastSeenAgent === 'number' ? val.lastSeenAgent : 0;
      if (agora - lastSeen > CANAL_TTL_MS) {
        updates[`canais/${agentToken}`] = null;
        updates[`indexOperador/${val.operatorToken}`] = null;
        updates[`cmds/${agentToken}`] = null;
        updates[`results/${agentToken}`] = null;
      } else {
        vivos += 1;
      }
    }
  }
  updates['meta/canaisAtivos'] = vivos;
  await base.update(updates);
  return vivos;
}

/* ------------------------------------------------------------------ */
/* Backend                                                               */
/* ------------------------------------------------------------------ */

export function createFirebaseBackend(rootEnv?: string): PonteBackend {
  const root = (rootEnv ?? process.env.PONTE_FIREBASE_ROOT ?? '').replace(/^\/+|\/+$/g, '');
  const startedAt = nowMs();
  const db = () => getDatabase(adminApp());
  const ref = (p: string) => db().ref(`${root}/${p}`.replace(/^\/+/, ''));

  /** Canal por agentToken (null = 401). */
  async function canalDoAgente(token: string | null): Promise<{ agentToken: string; canal: CanalRow } | null> {
    if (!token) return null;
    const snap = await ref(`canais/${token}`).get();
    if (!snap.exists()) return null;
    const canal = snap.val() as CanalRow;
    if (typeof canal?.operatorToken !== 'string') return null;
    return { agentToken: token, canal };
  }

  /** agentToken por operatorToken (null = 401) — o índice reverso §7. */
  async function agenteDoOperador(token: string | null): Promise<string | null> {
    if (!token) return null;
    const snap = await ref(`indexOperador/${token}`).get();
    if (!snap.exists()) return null;
    const val = snap.val() as { agentToken?: unknown };
    return typeof val?.agentToken === 'string' ? val.agentToken : null;
  }

  return {
    async registerPair(agentToken, operatorToken): Promise<RegisterPairOutcome> {
      if (typeof agentToken !== 'string' || typeof operatorToken !== 'string') {
        return { ok: false, status: 400, error: 'agentToken e operatorToken são obrigatórios (strings)' };
      }
      if (TOKEN_RE.test(agentToken) !== true) {
        return { ok: false, status: 400, error: 'agentToken inválido — formato esperado: gcpt_ + 36 hex' };
      }
      if (TOKEN_RE.test(operatorToken) !== true) {
        return { ok: false, status: 400, error: 'operatorToken inválido — formato esperado: gcpt_ + 36 hex' };
      }
      const vivos = await sweep(root);
      const base = ref('');
      const velhoAgente = (await base.child(`canais/${agentToken}`).get()).val() as CanalRow | null;
      const velhoIdx = (await base.child(`indexOperador/${operatorToken}`).get()).val() as { agentToken?: string } | null;
      const reuso = velhoAgente !== null || velhoIdx !== null;
      if (reuso !== true && vivos >= MAX_CANAIS) {
        return {
          ok: false,
          status: 400,
          error: 'Relay cheio (limite de canais) — use um self-host: github.com/lucasgabrieldevgg/ponte-local',
        };
      }
      const agora = nowMs();
      const updates: Record<string, unknown> = {};
      // revogação por reuso: o canal antigo morre INTEIRO (comandos e resultados)
      if (velhoAgente !== null && typeof velhoAgente.operatorToken === 'string') {
        updates[`indexOperador/${velhoAgente.operatorToken}`] = null;
        updates[`cmds/${agentToken}`] = null;
        updates[`results/${agentToken}`] = null;
      }
      if (velhoIdx !== null && typeof velhoIdx.agentToken === 'string' && velhoIdx.agentToken !== agentToken) {
        updates[`canais/${velhoIdx.agentToken}`] = null;
        updates[`cmds/${velhoIdx.agentToken}`] = null;
        updates[`results/${velhoIdx.agentToken}`] = null;
      }
      updates[`canais/${agentToken}`] = {
        operatorToken,
        createdAt: agora,
        lastSeenAgent: agora,
        totalCommands: 0,
        totalResults: 0,
        pendingCount: 0,
      } satisfies CanalRow;
      updates[`indexOperador/${operatorToken}`] = { agentToken };
      await base.update(updates);
      await base.child('meta/totalPairs').set(ServerValue.increment(1));
      return { ok: true };
    },

    async poll(agentToken, cursor): Promise<PollOutcome> {
      const achado = await canalDoAgente(agentToken);
      if (achado === null) return { ok: false, status: 401 };
      const { agentToken: ag } = achado;
      const base = ref('');
      const agora = nowMs();
      await base.child(`canais/${ag}`).update({ lastSeenAgent: agora });

      // primeiro poll (sem cursor): fresh-skip — backlog antigo é PULADO
      if (cursor === null) {
        const last = await base.child(`cmds/${ag}`).orderByKey().limitToLast(1).get();
        let maxId = 0;
        if (last.exists()) {
          const row = Object.values(last.val() as Record<string, { id?: unknown }>)[0];
          if (typeof row?.id === 'number') maxId = row.id;
        }
        return { ok: true, commands: [], nextCursor: maxId, fresh: true };
      }

      const snap = await base
        .child(`cmds/${ag}`)
        .orderByKey()
        .startAt(pad(cursor + 1))
        .limitToFirst(MAX_CMD_FETCH)
        .get();
      const pendentes: { id: number; action: string; args?: Record<string, unknown>; ts: number }[] = [];
      let maxVisto = cursor;
      if (snap.exists()) {
        const rows = snap.val() as Record<string, {
          id?: unknown; action?: unknown; args?: unknown; ts?: unknown;
          claimedAt?: unknown; doneAt?: unknown;
        }>;
        const claims: Record<string, unknown> = {};
        for (const [key, row] of Object.entries(rows)) {
          if (typeof row?.id !== 'number') continue;
          if (row.id > maxVisto) maxVisto = row.id;
          if (row.doneAt !== undefined && typeof row.doneAt === 'number') continue;
          const claimValido =
            typeof row.claimedAt === 'number' && agora - row.claimedAt < CLAIM_LEASE_MS;
          if (claimValido) continue;
          pendentes.push({
            id: row.id,
            action: String(row.action ?? ''),
            args: (row.args as Record<string, unknown> | undefined) ?? undefined,
            ts: typeof row.ts === 'number' ? row.ts : agora,
          });
          claims[`cmds/${ag}/${key}/claimedAt`] = agora;
        }
        if (Object.keys(claims).length > 0) await base.update(claims);
      }
      return { ok: true, commands: pendentes, nextCursor: maxVisto, fresh: false };
    },

    async addResult(agentToken, result): Promise<AddResultOutcome> {
      const achado = await canalDoAgente(agentToken);
      if (achado === null) return { ok: false, status: 401 };
      const { agentToken: ag } = achado;
      const base = ref('');
      const key = pad(result.id);
      const updates: Record<string, unknown> = {
        [`results/${ag}/${key}`]: { ...result, ts: nowMs() },
        [`cmds/${ag}/${key}/doneAt`]: nowMs(),
        [`canais/${ag}/totalResults`]: ServerValue.increment(1),
      };
      await base.update(updates);
      // decremento guardado: resultado duplicado (reenvio não-confirmado) não
      // deixa o pendingCount negativo — o gate de MAX_PENDING segue honesto.
      await base.child(`canais/${ag}/pendingCount`).transaction((cur) => {
        return typeof cur === 'number' && cur > 0 ? cur - 1 : 0;
      });
      return { ok: true };
    },

    async addCommand(operatorToken, action, args): Promise<AddCommandOutcome> {
      const ag = await agenteDoOperador(operatorToken);
      if (ag === null) return { ok: false, status: 401 };
      const base = ref('');
      // gate da fila: transaction aborta (undefined) quando a fila está cheia
      let filaCheia = false;
      const gate = await base.child(`canais/${ag}/pendingCount`).transaction((cur) => {
        const atual = typeof cur === 'number' ? cur : 0;
        if (atual >= MAX_PENDING) {
          filaCheia = true;
          return undefined; // aborta sem escrever
        }
        return atual + 1;
      });
      if (filaCheia || gate.committed !== true) {
        return { ok: false, status: 429, error: 'Fila de comandos cheia (o app não está respondendo?)' };
      }
      // id monotônico global (transaction no contador)
      let id = 0;
      const seq = await base.child('meta/seq').transaction((cur) => {
        return (typeof cur === 'number' ? cur : 0) + 1;
      });
      const seqVal = seq.snapshot.val();
      if (typeof seqVal === 'number') id = seqVal;
      if (id <= 0) {
        //rollback honesto do gate: sem id não há comando
        await base.child(`canais/${ag}/pendingCount`).transaction((cur) =>
          typeof cur === 'number' && cur > 0 ? cur - 1 : 0,
        );
        return { ok: false, status: 429, error: 'Falha ao gerar id do comando' };
      }
      await base.child(`cmds/${ag}/${pad(id)}`).set({
        id,
        action,
        args: args ?? {},
        ts: nowMs(),
      });
      await base.child(`canais/${ag}/totalCommands`).set(ServerValue.increment(1));
      return { ok: true, id };
    },

    async resultsSince(operatorToken, since): Promise<ResultsSinceOutcome> {
      const ag = await agenteDoOperador(operatorToken);
      if (ag === null) return { ok: false, status: 401 };
      const snap = await ref(`results/${ag}`)
        .orderByKey()
        .startAt(pad(since + 1))
        .limitToFirst(MAX_RESULTS_SLICE)
        .get();
      const results: {
        id: number; ok: boolean; data?: unknown; error?: string; durationMs?: number; ts: number;
      }[] = [];
      if (snap.exists()) {
        for (const row of Object.values(
          snap.val() as Record<string, Record<string, unknown>>,
        )) {
          if (typeof row?.id !== 'number' || typeof row?.ok !== 'boolean') continue;
          results.push({
            id: row.id,
            ok: row.ok,
            data: row.data,
            error: typeof row.error === 'string' ? row.error : undefined,
            durationMs: typeof row.durationMs === 'number' ? row.durationMs : undefined,
            ts: typeof row.ts === 'number' ? row.ts : nowMs(),
          });
        }
      }
      const lastId = results.length ? results[results.length - 1].id : since;
      return { ok: true, results, lastId };
    },

    async stats(): Promise<StatsOutcome> {
      const base = ref('');
      const [totalPairsSnap, canaisSnap] = await Promise.all([
        base.child('meta/totalPairs').get(),
        base.child('meta/canaisAtivos').get(),
      ]);
      return {
        ok: true,
        canaisAtivos: typeof canaisSnap.val() === 'number' ? canaisSnap.val() : 0,
        totalPareamentos: typeof totalPairsSnap.val() === 'number' ? totalPairsSnap.val() : 0,
        uptimeS: Math.round((nowMs() - startedAt) / 1000),
      };
    },
  };
}
