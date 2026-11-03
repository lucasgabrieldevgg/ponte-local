// POST/GET /api/ponte/boot — TELEMETRIA DE BOOT do app GalaxyCut [v1.7.8/campo].
//
// O porquê de existir: o dono relatou "o AppImage não abre" SEM NENHUM rastro
// na máquina dele — o boot.log nasce e morre lá, e o líder fica cego a 3.000
// km do problema. Este canal resolve: o processo MAIN do app (que sobe antes
// da janela, e sobe mesmo quando o renderer morre) manda beacons pequenos em
// cada marco e cada tropeço do boot. Se o app não abrir, o boot.log inteiro
// chega aqui sozinho.
//
// Contrato:
//   POST — header x-beacon-key (chave embutida no app; só pode ESCREVER
//          beacons). Corpo: { outcome, version, platform, arch, osRelease,
//          hostname, escada, mode, display, argv, bootMs, extra, bootLog }.
//          Teto: corpo ≤ 16 KB. A chave NÃO dá direito de leitura.
//   GET  — header x-ponte-token (token de AGENTE do canal, como todo o
//          relay). ?limit=N (1..50, default 20) → últimos beacons.
//
// Armazenamento: Firebase RTDB quando o relay roda com PONTE_BACKEND=firebase
// (produção) — caminho boots/app/{chave-ordenável}. Self-host em memória:
// array bounded (fallback honesto, perde no restart — igual ao backend
// memória da fila). Nada de PII além do que o app já manda (hostname, SO).
import { NextRequest } from 'next/server';
import { getApp, getApps, initializeApp, cert, type App } from 'firebase-admin/app';
import { getDatabase, type Database } from 'firebase-admin/database';

export const dynamic = 'force-dynamic';

/** Chave de escrita do app (embutida no main.js — defender em profundidade). */
const BOOT_BEACON_KEY = process.env.BOOT_BEACON_KEY ?? 'gcbk_34b4592c0416c4807f612ea2da1dbfc6a7f7';
const MAX_BODY_BYTES = 16 * 1024;
const MAX_KEEP = 200; // teto total armazenado (trim oportunista)
const MAX_RETURN = 50;

type BootReport = {
  ts: number;
  outcome: string;
  version?: string;
  platform?: string;
  arch?: string;
  osRelease?: string;
  hostname?: string;
  escada?: number;
  mode?: string;
  display?: string;
  argv?: string;
  bootMs?: number;
  extra?: unknown;
  bootLog?: string;
};

/* ---------------- backend: firebase (prod) | memória (self-host) ---------------- */

const g = globalThis as unknown as {
  __ponteFbApp?: App;
  __ponteBootsMem?: BootReport[];
};

function adminApp(): App | null {
  const saRaw = process.env.FIREBASE_SERVICE_ACCOUNT;
  const dbUrl = process.env.FIREBASE_DATABASE_URL;
  if (!saRaw || !dbUrl) return null;
  if (g.__ponteFbApp === undefined) {
    let sa: unknown;
    try { sa = JSON.parse(saRaw); } catch { return null; }
    g.__ponteFbApp = getApps().length
      ? getApp()
      : initializeApp({ credential: cert(sa as never), databaseURL: dbUrl });
  }
  return g.__ponteFbApp;
}

function bootsRef(): { db: Database; path: string } | null {
  const a = adminApp();
  if (!a) return null;
  return { db: getDatabase(a), path: 'boots/app' };
}

function memStore(): BootReport[] {
  if (!g.__ponteBootsMem) g.__ponteBootsMem = [];
  return g.__ponteBootsMem;
}

/** Chave ordenável lexicograficamente: ms com zero-pad + sufixo aleatório. */
function bootKey(ts: number): string {
  return `${String(ts).padStart(15, '0')}-${Math.random().toString(36).slice(2, 8)}`;
}

async function saveBoot(report: BootReport): Promise<void> {
  const fb = bootsRef();
  if (fb) {
    await fb.db.ref(`${fb.path}/${bootKey(report.ts)}`).set(report);
    // trim oportunista: mantém só os MAX_KEEP mais recentes
    try {
      const total = (await fb.db.ref(fb.path).get()).numChildren();
      if (total > MAX_KEEP) {
        const excesso = total - MAX_KEEP;
        const antigas = await fb.db.ref(fb.path).limitToFirst(Number(excesso)).get();
        const upd: Record<string, null> = {};
        antigas.forEach((c) => { upd[c.key as string] = null; });
        if (Object.keys(upd).length) await fb.db.ref(fb.path).update(upd);
      }
    } catch {
      /* trim falhou: o beacon já está salvo, o teto é higiene */
    }
    return;
  }
  const mem = memStore();
  mem.push(report);
  if (mem.length > MAX_KEEP) mem.splice(0, mem.length - MAX_KEEP);
}

async function listBoots(limit: number): Promise<BootReport[]> {
  const fb = bootsRef();
  if (fb) {
    const snap = await fb.db.ref(fb.path).limitToLast(limit).get();
    const out: BootReport[] = [];
    snap.forEach((c) => { out.push(c.val() as BootReport); });
    return out.reverse(); // mais recente primeiro
  }
  return memStore().slice(-limit).reverse();
}

/* -------------------------------- POST -------------------------------- */

export async function POST(req: NextRequest) {
  const key = req.headers.get('x-beacon-key');
  if (!key || key !== BOOT_BEACON_KEY) {
    return Response.json({ ok: false, error: 'beacon key inválida' }, { status: 401 });
  }
  let body: Record<string, unknown>;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) {
      return Response.json({ ok: false, error: 'beacon grande demais' }, { status: 413 });
    }
    body = JSON.parse(raw);
  } catch {
    return Response.json({ ok: false, error: 'JSON inválido' }, { status: 400 });
  }
  const outcome = typeof body.outcome === 'string' ? body.outcome.slice(0, 120) : '';
  if (!outcome) {
    return Response.json({ ok: false, error: 'outcome obrigatório' }, { status: 400 });
  }
  const str = (v: unknown, max: number): string | undefined =>
    typeof v === 'string' && v.length ? v.slice(0, max) : undefined;
  const report: BootReport = {
    ts: Date.now(),
    outcome,
    version: str(body.version, 40),
    platform: str(body.platform, 30),
    arch: str(body.arch, 20),
    osRelease: str(body.osRelease, 120),
    hostname: str(body.hostname, 120),
    escada: typeof body.escada === 'number' ? body.escada : undefined,
    mode: str(body.mode, 40),
    display: str(body.display, 120),
    argv: str(body.argv, 300),
    bootMs: typeof body.bootMs === 'number' ? body.bootMs : undefined,
    extra: body.extra ?? undefined,
    bootLog: str(body.bootLog, 4000),
  };
  // RTDB rejeita valores `undefined` no set() — campos ausentes simplesmente
  // não entram no objeto (a provação local em memória não pega isso).
  for (const k of Object.keys(report) as (keyof BootReport)[]) {
    if (report[k] === undefined) delete report[k];
  }
  try {
    await saveBoot(report);
  } catch (e) {
    return Response.json(
      { ok: false, error: 'falha ao guardar beacon', detalhe: String(e).slice(0, 250) },
      { status: 500 },
    );
  }
  return Response.json({ ok: true });
}

/* --------------------------------- GET --------------------------------- */

export async function GET(req: NextRequest) {
  const token = req.headers.get('x-ponte-token');
  if (!token) {
    return Response.json({ ok: false, error: 'token de agente ausente' }, { status: 401 });
  }
  // valida o formato do token da casa antes de tocar o banco
  if (!/^gcpt_[0-9a-f]{36}$/.test(token) && !/^gcpt_[A-Za-z0-9_-]+$/.test(token)) {
    return Response.json({ ok: false, error: 'token de agente inválido' }, { status: 401 });
  }
  const url = new URL(req.url);
  const limit = Math.min(MAX_RETURN, Math.max(1, parseInt(url.searchParams.get('limit') ?? '20', 10) || 20));
  try {
    const boots = await listBoots(limit);
    return Response.json({ ok: true, count: boots.length, boots });
  } catch {
    return Response.json({ ok: false, error: 'falha ao listar beacons' }, { status: 500 });
  }
}
