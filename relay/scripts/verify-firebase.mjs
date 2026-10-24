#!/usr/bin/env node
// verify-firebase.mjs — t42: o MESMO contrato do verify-relay, agora contra
// o backend Firebase RTDB (PONTE_BACKEND=firebase), com a prova que dá
// sentido à tarefa: PERSISTÊNCIA PÓS-RESTART.
//
//   R1–R12  a bateria idêntica (importada de verify-relay.mjs) rodando
//           contra um dev server com PONTE_BACKEND=firebase, num root de
//           teste isolado do banco real (PONTE_FIREBASE_ROOT=verify-t42)
//   R13     o dev server é MORTO E RESSUSCITADO (o equivalente local de a
//           instância serverless reciclar): o canal pareado antes do
//           restart continua VIVO, recebe comandos novos e devolve
//           resultados — porque o estado mora no RTDB, não na memória.
//           (no backend memória este cenário expira o canal: 401)
//   R14     regras LOCKED: leitura E escrita ANÔNIMAS no banco são NEGADAS
//           (o Admin SDK ignora regras; cliente público nenhum toca o RTDB)
//
// Credenciais (uma das duas):
//   FIREBASE_SERVICE_ACCOUNT  = JSON completo da service account (inline)
//   FIREBASE_KEY_FILE         = caminho de um arquivo .json da service account
// FIREBASE_DATABASE_URL      = URL do RTDB (default: projeto da casa)
//
// Uso: npm run verify:firebase
// Fim: o root de teste é REMOVIDO do banco (deixa o RTDB limpo).

import fs from 'node:fs';
import { subirServidor, descerServidor, bateria } from './verify-relay.mjs';

const PORT = 3198;
const PORT_RESTART = 3197;
const ROOT_TESTE = 'verify-t42';
const DB_URL = process.env.FIREBASE_DATABASE_URL ?? 'https://galaxy-ponte-default-rtdb.firebaseio.com';

function lerServiceAccount() {
  const inline = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (inline !== undefined && inline.trim().startsWith('{')) return inline;
  const arquivo = process.env.FIREBASE_KEY_FILE ?? '/home/z/my-project/scripts/.firebase_key.json';
  if (fs.existsSync(arquivo) !== true) {
    throw new Error('forneça FIREBASE_SERVICE_ACCOUNT (JSON) ou FIREBASE_KEY_FILE (caminho do .json)');
  }
  return fs.readFileSync(arquivo, 'utf8');
}

const SA_JSON = lerServiceAccount();
const envDoServidor = {
  PONTE_BACKEND: 'firebase',
  FIREBASE_SERVICE_ACCOUNT: SA_JSON,
  FIREBASE_DATABASE_URL: DB_URL,
  PONTE_FIREBASE_ROOT: ROOT_TESTE,
};

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

async function cleanupRtdb() {
  // remove o root de teste usando o firebase-admin DIRETO (sem servidor)
  // (cert vem de firebase-admin/app — 'firebase-admin/credential' não é
  // subpath exportável e o import estoura no firebase-admin v14)
  const { initializeApp, cert } = await import('firebase-admin/app');
  const { getDatabase } = await import('firebase-admin/database');
  const sa = JSON.parse(SA_JSON);
  const app = initializeApp({ credential: cert(sa), databaseURL: DB_URL }, `cleanup-${Date.now()}`);
  try {
    await getDatabase(app).ref(ROOT_TESTE).remove();
    console.log(`[verify-firebase] root de teste '${ROOT_TESTE}' removido do RTDB.`);
  } finally {
    await app.delete();
  }
}

try {
  console.log(`[verify-firebase] banco: ${DB_URL} · root de teste: ${ROOT_TESTE}`);
  console.log(`[verify-firebase] subindo next dev em :${PORT} (backend: firebase)…`);
  const srv = await subirServidor(PORT, envDoServidor);
  try {
    console.log(`[verify-firebase] relay no ar — MESMA bateria, backend Firebase\n`);
    const resultado = await bateria(srv.base);
    pass += resultado.pass;
    fail += resultado.fail;
    const { agentNovo, operator } = resultado;
    // cursor que o "app" teria após a bateria: qualquer comando já visto
    const rFresh = await fetch(`${srv.base}/api/ponte/poll`, { headers: { 'x-ponte-token': agentNovo } });
    const bFresh = await rFresh.json();
    const cursorAteAqui = bFresh.nextCursor ?? 0;

    // --- R14: regras LOCKED — banco recusa leitura E escrita anônimas ---
    let rAnon = await fetch(`${DB_URL}/${ROOT_TESTE}/.json`);
    ok(rAnon.status === 401, 'R14a regras LOCKED: leitura ANÔNIMA do banco é NEGADA (401)');
    rAnon = await fetch(`${DB_URL}/${ROOT_TESTE}/probe-anonima.json`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: '{"x":1}',
    });
    ok(rAnon.status === 401, 'R14b regras LOCKED: escrita ANÔNIMA do banco é NEGADA (401)');

    console.log(`\n[verify-firebase] RESTART do servidor (o equivalente local de a instância reciclar)…`);
    await descerServidor(srv.proc);
    const srv2 = await subirServidor(PORT_RESTART, envDoServidor);
    try {
      console.log(`[verify-firebase] servidor NOVO no ar — provando persistência\n`);
      // R13a: o canal pareado ANTES do restart continua vivo
      let r = await fetch(`${srv2.base}/api/ponte/poll`, { headers: { 'x-ponte-token': agentNovo } });
      ok(r.status === 200, 'R13a canal pareado antes do restart AINDA VIVO (estado no RTDB, não na memória)');
      // R13b: comando novo flui
      r = await fetch(`${srv2.base}/api/ponte/cmd`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-ponte-token': operator },
        body: JSON.stringify({ action: 'ponte_ping', args: { depois: 'restart' } }),
      });
      const bCmd = await r.json();
      ok(r.status === 200 && typeof bCmd.id === 'number', 'R13b IA web enfileira comando novo pós-restart');
      // R13c: o app (com o cursor de antes) recebe e devolve
      r = await fetch(`${srv2.base}/api/ponte/poll?cursor=${cursorAteAqui}`, { headers: { 'x-ponte-token': agentNovo } });
      const bPoll = await r.json();
      const cmdNovo = (bPoll.commands ?? []).find((c) => c.id === bCmd.id);
      ok(cmdNovo !== undefined && cmdNovo.action === 'ponte_ping', 'R13c app recebe o comando novo (cursor preservado pelo RTDB)');
      r = await fetch(`${srv2.base}/api/ponte/result`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-ponte-token': agentNovo },
        body: JSON.stringify({ id: bCmd.id, ok: true, data: { pong: true, posRestart: true } }),
      });
      ok(r.status === 200, 'R13d app devolve o resultado pós-restart');
      r = await fetch(`${srv2.base}/api/ponte/results?since=${bCmd.id - 1}`, { headers: { 'x-ponte-token': operator } });
      const bRes = await r.json();
      const resNovo = (bRes.results ?? []).find((x) => x.id === bCmd.id);
      ok(resNovo !== undefined && resNovo.ok === true && resNovo.data?.posRestart === true, 'R13e IA web lê o resultado do ciclo pós-restart');
    } finally {
      await descerServidor(srv2.proc);
    }
  } finally {
    // garante que o primeiro servidor também morra se algo estourar no meio
    if (srv.proc.exitCode === null) await descerServidor(srv.proc);
  }

  console.log('\n====================================================================');
  console.log(`verify-firebase — ${pass + fail} asserções, ${fail} falhas`);
  console.log('====================================================================');
  if (fail === 0) {
    console.log('BACKEND FIREBASE VERDE — mesmo contrato do relay, com persistência real.');
  }
  process.exitCode = fail === 0 ? 0 : 1;
} catch (e) {
  console.error('[verify-firebase] ERRO:', e.message);
  process.exit(1);
} finally {
  try {
    await cleanupRtdb();
  } catch (e) {
    console.error('[verify-firebase] cleanup falhou:', e.message);
  }
}
