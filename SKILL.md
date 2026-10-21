# GalaxyCut-AI — skill do Modo Ponte

Você (a IA) vai operar o EDITOR DE VÍDEO GalaxyCut-AI do usuário, pelo chat.
O app do usuário faz poll a cada 1,5 s no relay, executa o comando no
editor REAL e devolve o resultado. Tudo são conexões de SAÍDA — sem portas
abertas, firewall ou VPN. A superfície é o editor: timeline, clipes, áudio,
legendas, animação, export. Nada além disso.

## Protocolo (curl puro)

```bash
export PONTE_URL=<URL-do-relay>
export PONTE_TOKEN=<token-do-bloco>

# enfileira um comando — a resposta traz {"ok":true,"id":N}
curl -s -X POST $PONTE_URL/api/ponte/cmd \
  -H "x-ponte-token: $PONTE_TOKEN" -H "Content-Type: application/json" \
  -d '{"action":"ponte_ping","args":{}}'

# alguns segundos depois, leia os resultados desde id-1
curl -s "$PONTE_URL/api/ponte/results?since=0" -H "x-ponte-token: $PONTE_TOKEN"
```

Resposta de cada comando: `{"id","ok","data"|"error","durationMs"}`.
`results?since=X` devolve `{"ok":true,"results":[...],"lastId":M}` — o
`lastId` é o seu próximo cursor `since`. Resultado vazio: releia em 3–5 s
(o app polla a cada 1,5 s; o round-trip típico é 5–15 s — honesto, não
tempo real).

## Comece sempre assim

1. `ponte_ping` — valida a conexão (devolve versão, modo atual e a
   contagem viva de tools). O app do usuário acende a luz verde.
2. `ponte_get_context` — leia o projeto INTEIRO (timeline tabular, mídia,
   worklog, playhead). É o mesmo bloco que o cérebro interno do app lê a
   cada turno. Peça de novo quando precisar de frescor.
3. Conversa com o usuário sobre o que fazer. Depois execute.

## As ações (lista fixa — derivada do registry do app)

- Edição de timeline: `timeline_*` (split, reorder, remove_silences,
  remove_fillers, pacing curve, speed ramping)
- Visual: `visual_*` (color grading, punch-in, smart blur, auto reframe,
  b-roll, overlay, inspect_frame)
- Áudio: `audio_*` (ducking, normalize, stems, beat match, bg music, sfx)
- Legendas: `subtitle_*` (word-sync, preset, highlight, emojis)
- Animação em código: `code_*` (generate TSX, inject, inspect)
- Estilo: `style_*` (DNA) · Marketing: `marketing_*` (thumbnail, metadata)
- Memória da sessão: `memory_*` (read/write worklog, snapshots)
- Mídia: `media_*` (import de pasta local, download de URL, busca de stock)
- Modelos locais: `local_models_status` (leitura sem risco: estado REAL do que
  está instalado — Ollama respondendo? quais tags? Whisper em cache? se faltar
  algo, PEÇA ao usuário com o caminho que vem em requests; nunca finja estado)
- Sessão e plano: `plan_*` (propose), `subagent_*` (delegate_task), `session_*`
  (ask_clarification, request_human_review, finish_and_render)
- Meta-ações da ponte: `ponte_ping`, `ponte_get_context`, `ponte_status`

A lista é derivada do registry do app e ACOMPANHA ele sozinha: a contagem
exata está no `ponte_ping` e a recusa ensina o nome correto. Argumentos
obrigatórios vêm do próprio schema — a recusa diz quais faltam.

## Fronteira PERMANENTE — não existe, não tente

Não existe `system_run_command`, não existe ação de arquivo (`list`,
`read_text`, `write_text`, `move`, `delete`, `organize_plan`…), não
existe shell, não existe ler pastas do PC. A recusa é dura ("Ação
desconhecida — fora da lista fixa permitida"), é auditada na cara do
usuário e NADA executa. O app é um editor de vídeo — a ponte opera o
editor, não o computador.

## Regras de ouro

1. **Plano primeiro.** Lote de mutação = proponha com `plan_propose` ANTES
   de executar. O usuário aprova NO APP (card de plano) — você não aprova o
   próprio plano. Depois de propor, consulte `ponte_status` (campo
   `planPhase`) até virar `executing`; aí envie os passos UM A UM, na ordem
   aprovada. Passo fora da ordem exige `deviation_reason`.
2. **Destrutivo = confirmado.** Operação abrangente (acelerar TODOS os
   clipes, cortar mais de 20% da duração) devolve um gate pedindo
   `session_ask_clarification` com `gate_key`. A pergunta abre NA TELA do
   usuário e é ELE quem responde no app — você não consegue aprovar o
   próprio gate. Depois da aprovação, reenvie o comando com
   `confirmed: true`.
3. **Nunca afirme ação que não executou.** Só declare o que o result diz.
   Se falhou, diga que falhou e leia o `error` — ele sempre ensina o
   caminho.
4. PESQUISA: se você tem busca web própria, use-a livremente para o roteiro e os fatos — as tools research_web_search do app são opcionais. Você entra com o que JÁ tem; a ponte só opera o editor.
5. **Contexto antes de planejar.** `ponte_get_context` em cada plano
   novo — o estado muda entre comandos e o builder é a única fonte.
6. **Um comando por vez de qualidade.** Comandos pequenos e legíveis; o
   resultado de um orienta o próximo.

## Modos físicos (só o usuário troca — no app)

| Modo | O que você consegue |
|------|--------------------|
| **Observar** (padrão) | só leitura: ping, get_context, status |
| Editar | + toda a lista de edição (com gates) |
| Editar+Renderizar | + export (`session_finish_and_render`) |

Não existe comando de mudar modo — nem tente pedir: a recusa vai ensinar o
USUÁRIO a religar no app, e é ele quem decide.

## Erros honestos (todos ensinam)

- `modo atual: Observar — …— religue no app`: peça ao usuário para religar.
- `comando #N recusado` + motivo: leia, corrija, reenvie.
- `401`: o pareamento foi revogado (o usuário desemparelhou ou gerou um
  novo bloco) — pare e avise.
- Comandos que sumiram no religamento do app: o primeiro poll é
  `fresh=true` e o backlog antigo é DESCARTADO de propósito (não se
  executa lixo de sessão passada) — o campo `skipped` da resposta diz
  quantos pendentes foram pulados; reenvie o que ainda importa.
- Relay fora: results vazio e status mostra desconectado — o editor do
  usuário segue 100% funcional, só a ponte espera.

## Limites do protocolo (herdados do molde)

| Limite | Valor |
|--------|-------|
| Tamanho do comando | 4.000 caracteres |
| Resposta do comando | 150.000 caracteres (corte SEMPRE rotulado) |
| Fila de comandos pendentes | 100 |
| Histórico de resultados | 400 |
| Janela "conectado" | 15 s sem poll |
| Lease de entrega | 120 s (reenvio sem reexecução — ids únicos por comando) |

## Pareamento e token (prática segura)

O token deste bloco mora no histórico deste chat — foi desenhado ASSIM
(zero fricção). O colchão: um token ativo por vez (parear de novo revoga
este), revogação em 1 clique no app, e TODOS os comandos são auditados com
o id. Terminou a sessão? Peça ao usuário para desemparelhar no painel do
app. O que transita pela internet: JSON de metadados (nomes de clipes,
timestamps, sumários) — os arquivos de mídia NUNCA saem do PC do usuário.

---
Fonte viva desta skill: github.com/lucasgabrieldevgg/ponte-local (fork do
ponte-local de MicaelSanPedro, MIT). A lista de ações acima é derivada do
registry do app — se o app crescer, o bloco colável traz a versão fresca.

GalaxyCut-AI · Modo Ponte · adaptação do modelo ponte-local de
MicaelSanPedro (MIT) — as ações de arquivo/comando do original foram
substituídas pela superfície de edição do app.
