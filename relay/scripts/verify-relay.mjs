#!/usr/bin/env node
// verify-relay.mjs — prova RE-EXECUTÁVEL do contrato do relay da ponte
// GalaxyCut (fork do ponte-local, MIT MicaelSanPedro).
//
// O que prova (round-trip REAL contra um relay de verdade):
//   R1  POST /pair registra o canal (app → relay)
//   R2  GET  /poll sem cursor → fresh=true, backlog pulado (P13 da casa)
//   R3  POST /cmd com token de OPERADOR enfileira (IA web)
//   R4  GET  /poll com cursor entrega o comando ao AGENTE (app)
//   R5  POST /result devolve o resultado (app)
//   R6  GET  /results?since lê o resultado (IA web)
//   R7  separação de tokens (§7): agentToken é RECUSADO no /cmd
//   R8  operatorToken é RECUSADO no /poll
//   R9  /pair com token malformado → 400
//   R10 re-pareamento revoga o canal anterior NA HORA (P1)
//   R11 /status público sem segredos (sem tokens, sem ações)
//   R12 lease: comando não respondido volta pra fila após o lease
//
// Uso: npm run verify   (sobe o dev server sozinho na porta 3199 e mata no fim)
//
// t42: a BATERIA é a mesma para os dois backends — verify-firebase.mjs
// importa subirServidor/bateria/descerServidor daqui e roda o mesmo
// contrato contra PONTE_BACKEND=firebase (+ R13, persistência pós-restart).
// Contrato é contrato: se uma implementação divergir, o verify aponta.

import { spawn } from 'node:child_process';
import path from 'node:path';

const PORT = 3199;
const ROOT = path.resolve(import.meta.dirname, '..');

export const hex = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
export const token = () => `gcpt_${hex(36)}`;

export async function subirServidor(port, envExtra = {}) {
  const proc = spawn('npx', ['next', 'dev', '-p', String(port)], {
    cwd: ROOT,
    stdio: 'ignore',
    detached: false,
    env: { ...process.env, ...envExtra },
  });
  const base = `http://127.0.0.1:${port}`;
  const t0 = Date.now();
  for (;;) {
    try {
      const r = await fetch(`${base}/api/ponte/status`);
      if (r.status === 200) return { proc, base };
    } catch {}
    if (Date.now() - t0 > 120_000) throw new Error(`relay não subiu em 120 s (porta ${port})`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

export async function descerServidor(proc) {
  if (proc.exitCode === null) {
    proc.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 800));
  }
}

/** Bateria R1–R12 contra BASE. Retorna tokens e placar. */
export async function bateria(BASE, prefixo = '') {
  let pass = 0;
  let fail = 0;
  const ok = (cond, label) => {
    if (cond === true) {
      pass += 1;
      console.log(`  ✓ ${label}`);
    } else {
      fail += 1;
      console.error(`  ✗ FALHOU: ${label}`);
    }
  };

  const AGENT = token();
  const OPERATOR = token();

  // --- R1: /pair registra ---
  let r = await fetch(`${BASE}/api/ponte/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ agentToken: AGENT, operatorToken: OPERATOR }),
  });
  let b = await r.json();
  ok(r.status === 200 && b.ok === true, `${prefixo}R1 POST /pair registra o canal (app → relay)`);

  // --- R9: /pair com token malformado ---
  r = await fetch(`${BASE}/api/ponte/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ agentToken: 'sem-prefixo', operatorToken: OPERATOR }),
  });
  b = await r.json();
  ok(r.status === 400 && b.ok === false, `${prefixo}R9 /pair com token malformado → 400 (formato gcpt_ + 36 hex)`);

  // --- R2: primeiro poll → fresh, backlog pulado ---
  r = await fetch(`${BASE}/api/ponte/poll`, { headers: { 'x-ponte-token': AGENT } });
  b = await r.json();
  ok(
    r.status === 200 && b.ok === true && b.fresh === true && b.commands.length === 0 && typeof b.nextCursor === 'number',
    `${prefixo}R2 primeiro poll sem cursor → fresh=true, backlog PULADO (P13)`,
  );

  // --- R8: operatorToken recusado no poll ---
  r = await fetch(`${BASE}/api/ponte/poll`, { headers: { 'x-ponte-token': OPERATOR } });
  ok(r.status === 401, `${prefixo}R8 operatorToken é RECUSADO no /poll (separação §7)`);

  // --- R3: IA web enfileira com o token do OPERADOR ---
  r = await fetch(`${BASE}/api/ponte/cmd`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ponte-token': OPERATOR },
    body: JSON.stringify({ action: 'ponte_ping', args: {} }),
  });
  b = await r.json();
  ok(r.status === 200 && b.ok === true && typeof b.id === 'number', `${prefixo}R3 POST /cmd com operatorToken enfileira (IA web)`);
  const cmdId = b.id;

  // --- R7: agentToken recusado no cmd ---
  r = await fetch(`${BASE}/api/ponte/cmd`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ponte-token': AGENT },
    body: JSON.stringify({ action: 'ponte_ping', args: {} }),
  });
  ok(r.status === 401, `${prefixo}R7 agentToken é RECUSADO no /cmd (separação §7 — T1 da casa)`);

  // --- R4: poll entrega o comando ao agente ---
  r = await fetch(`${BASE}/api/ponte/poll?cursor=0`, { headers: { 'x-ponte-token': AGENT } });
  b = await r.json();
  const cmd = (b.commands ?? []).find((c) => c.id === cmdId);
  ok(cmd !== undefined && cmd.action === 'ponte_ping', `${prefixo}R4 poll com cursor entrega o comando ao AGENTE (app)`);

  // --- R5: app devolve o resultado ---
  r = await fetch(`${BASE}/api/ponte/result`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ponte-token': AGENT },
    body: JSON.stringify({ id: cmdId, ok: true, data: { pong: true }, durationMs: 42 }),
  });
  b = await r.json();
  ok(r.status === 200 && b.ok === true, `${prefixo}R5 POST /result devolve o resultado (app)`);

  // --- R6: IA lê o resultado ---
  r = await fetch(`${BASE}/api/ponte/results?since=0`, { headers: { 'x-ponte-token': OPERATOR } });
  b = await r.json();
  const res = (b.results ?? []).find((x) => x.id === cmdId);
  ok(
    res !== undefined && res.ok === true && res.data?.pong === true && b.lastId === cmdId,
    `${prefixo}R6 GET /results?since lê o resultado (IA web) — lastId é o próximo cursor`,
  );

  // --- R11: /status público sem segredos ---
  r = await fetch(`${BASE}/api/ponte/status`);
  const raw = await r.text();
  b = JSON.parse(raw);
  ok(
    r.status === 200 && b.ok === true && b.version !== undefined &&
    raw.includes(AGENT) !== true && raw.includes(OPERATOR) !== true && raw.includes('ponte_ping') !== true,
    `${prefixo}R11 /status público SEM segredos (nem tokens, nem ações)`,
  );

  // --- R12: lease — comando não respondido volta pra fila ---
  r = await fetch(`${BASE}/api/ponte/cmd`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ponte-token': OPERATOR },
    body: JSON.stringify({ action: 'timeline_split_clip', args: { clip_id: 'x' } }),
  });
  b = await r.json();
  const id2 = b.id;
  r = await fetch(`${BASE}/api/ponte/poll?cursor=0`, { headers: { 'x-ponte-token': AGENT } });
  b = await r.json();
  const entregue1 = (b.commands ?? []).find((c) => c.id === id2) !== undefined;
  // dentro do lease (120 s): NÃO reentrega
  r = await fetch(`${BASE}/api/ponte/poll?cursor=0`, { headers: { 'x-ponte-token': AGENT } });
  b = await r.json();
  const entregue2 = (b.commands ?? []).find((c) => c.id === id2) !== undefined;
  ok(entregue1 === true && entregue2 === false, `${prefixo}R12 lease de 120 s: comando em curso NÃO é reentregue (dedup do transporte)`);

  // --- R10: re-pareamento revoga o canal anterior ---
  const AGENT2 = token();
  r = await fetch(`${BASE}/api/ponte/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ agentToken: AGENT2, operatorToken: OPERATOR }),
  });
  b = await r.json();
  ok(r.status === 200 && b.ok === true, `${prefixo}R10a re-pareamento aceito (mesmo operatorToken)`);
  r = await fetch(`${BASE}/api/ponte/poll`, { headers: { 'x-ponte-token': AGENT } });
  ok(r.status === 401, `${prefixo}R10b o agentToken ANTIGO morre na hora (canal substituído, P1)`);
  r = await fetch(`${BASE}/api/ponte/poll`, { headers: { 'x-ponte-token': AGENT2 } });
  b = await r.json();
  ok(r.status === 200 && b.fresh === true, `${prefixo}R10c o agentToken NOVO polla normal (fresh de novo)`);

  return { pass, fail, agent: AGENT, operator: OPERATOR, agentNovo: AGENT2 };
}

/* ------------------------------------------------------------------ */
/* Execução direta: backend MEMÓRIA (default, como sempre foi)           */
/* ------------------------------------------------------------------ */

const rodandoDireto = process.argv[1] !== undefined && process.argv[1].endsWith('verify-relay.mjs');
if (rodandoDireto) {
  console.log(`[verify-relay] subindo next dev em :${PORT} (backend: memória)…`);
  const { proc, base } = await subirServidor(PORT);
  try {
    console.log(`[verify-relay] relay no ar — contrato em ${base}/api/ponte/*\n`);
    const { pass, fail } = await bateria(base);
    console.log('\n====================================================================');
    console.log(`verify-relay — ${pass + fail} asserções, ${fail} falhas`);
    console.log('====================================================================');
    if (fail === 0) console.log('RELAY DA PONTE VERDE — contrato do app GalaxyCut fechado de ponta a ponta.');
    process.exitCode = fail === 0 ? 0 : 1;
  } finally {
    await descerServidor(proc);
  }
}
