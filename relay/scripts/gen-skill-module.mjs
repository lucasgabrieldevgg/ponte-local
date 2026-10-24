#!/usr/bin/env node
// gen-skill-module.mjs [t49] — gera src/lib/galaxycut-skill.ts a partir do
// SKILL.md raiz do fork (o artefato que o líder atualiza).
//
// O fluxo que a t44 provou no app (gen-ponte-skill-doc.mjs), agora do lado
// do relay: a skill NUNCA é lida do disco em runtime — o texto entra no
// bundle como MÓDULO COMPILADO, à prova de serverless (Vercel roda o build
// sem o arquivo solto; o route handler só importa a constante).
//
// Regenerar quando o SKILL.md raiz mudar:
//   npm run gen:skill        (ou: node scripts/gen-skill-module.mjs)
//
// O script é IDEMPOTENTE e CONFERENCE o round-trip: lê o SKILL.md, gera o
// módulo com escape JSON.stringify, re-avalia a string gerada e exige
// igualdade byte a byte com o original — um gerador silenciosamente errado
// seria pior que não ter rota.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');        // relay/
const FORK = path.resolve(ROOT, '..');                       // ponte-local/
const SRC = path.join(FORK, 'SKILL.md');
const DST = path.join(ROOT, 'src', 'lib', 'galaxycut-skill.ts');

const skill = fs.readFileSync(SRC, 'utf8');

const moduleSrc = `// ARQUIVO GERADO — não editar à mão. [t49]
// Fonte: ../SKILL.md (raiz do fork, ${skill.length} caracteres / ${Buffer.byteLength(skill, 'utf8')} bytes UTF-8)
// Regenerar: npm run gen:skill (scripts/gen-skill-module.mjs, round-trip conferido)
// A rota /skill/galaxycut.md serve ESTA constante — zero fs em runtime.
export const GALAXYCUT_SKILL_MD: string = ${JSON.stringify(skill)};
`;

// round-trip: a string que o TS vai avaliar tem que ser EXATAMENTE o SKILL.md
const evaled = JSON.parse(moduleSrc.slice(moduleSrc.indexOf('=') + 1, moduleSrc.lastIndexOf(';')));
if (evaled !== skill) {
  console.error('ERRO FATAL: round-trip do módulo gerado diverge do SKILL.md — NADA escrito.');
  process.exit(1);
}

fs.writeFileSync(DST, moduleSrc);
console.log(`gen-skill-module: ${path.relative(FORK, SRC)} → ${path.relative(FORK, DST)} (${Buffer.byteLength(skill, 'utf8')} bytes, round-trip OK)`);
