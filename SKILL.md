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
- Leitura & edição fina de clipes: `timeline_get_clips` (lê o conteúdo
  REAL: texto das legendas/transcrição, estilo, template — e a POSIÇÃO de
  TODO clipe {x, y, frac_top, locked} + volume: mídia, personagem e motion
  inclusos, não só legenda. frac_top é a MESMA fração do TOPO que o param
  position escreve — você lê na régua que escreve) e `timeline_update_clip`
  (edita UM clipe por id: corrige texto de legenda, move no tempo,
  reposiciona na preview com position top/center/bottom (bottom = 0.81 do
  topo — bottom-anchored) ou fração 0.02–0.98 do TOPO ('0.43' = strip
  universal de legenda), move de faixa com track, muda estilo/template e
  ajusta o VOLUME de áudio do clipe (param volume
  0.05..2.0 — 1 = unitário, 0.7 ≈ −3 dB; escreve no volume REAL: a prévia
  e o export leem o mesmo campo. Renomeie clipes de música pra `music_*`
  pra as tools de voz os pouparem) — edição individual, clipe a clipe)
- MONTAGEM — o clipe NASCE POSICIONADO (v1.7.6): `timeline_add_clip`
  (monta mídia da biblioteca da sessão pelo NOME exato; aceita `position`
  ('top' 0.18 · 'center' 0.5 · 'bottom' 0.81 · ou fração 0.02–0.98 do TOPO
  do frame — o clipe nasce TRAVADO com posLock), `x` (−1..1, 0 = centro),
  `zoom_pct` (40..200 — abaixo de 100 encolhe: logos/imagens largas),
  `volume` (0.05..2.0) e `name` na MESMA chamada). Cada elemento nasce
  no lugar certo em UM passo — SEM o update_clip extra pra posicionar (a
  skill de estilo do usuário manda nas CONSTANTES do formato; o contrato
  manda na régua). A cama de música já pode nascer renomeada music_* com
  volume 0.7 (≈ −3 dB). Faixas extras: `timeline_add_track` (V3/A3/T2…)
  antes de montar nelas
- Visual: `visual_*` (color grading, punch-in, smart blur, auto reframe,
  b-roll — o `visual_insert_broll` também aceita position/x/zoom_pct na
  criação: o b-roll de stock nasce posicionado, overlay,
  inspect_frame)
- Áudio: `audio_*` (ducking, normalize, enhance — `audio_enhance_voice` é o
  melhorador de voz do editor: SEM clip_id melhora TODOS os portadores de voz
  de uma vez (trilha de música e SFX poupados), a cadeia é a fixa do editor
  (highpass → compressor → limitador → +20% de ganho) e o campo que escreve
  é o MESMO que a prévia e o export leem · stems, beat match, bg music, sfx)
- Legendas: `subtitle_*` (word-sync, preset, highlight, emojis).
  `subtitle_apply_preset` aceita `custom_style_rules` — overrides de QUALQUER
  chave de estilo por cima do preset (font, color, strokeColor, strokeW,
  shadow, highlight, highlightColor, highlightAnim, typewriter, uppercase,
  size, bg…) — e `position` como fração do TOPO do frame (ex.: '0.5' = faixa
  no meio do frame)
- Animação em código: `code_*` — 23 templates com física de verdade
  (spring/damped paramétrica): cinematic_title (letterbox + tracking
  dourado), word_pop (cinética palavra a palavra), zoom_punch (impacto com
  speed-lines), badge_stamp (selo carimbado com shine), particle_burst
  (partículas + glow), lower_third (barra de broadcast), counter_badge
  (contador com anel de progresso), glitch_pop, spring_scale, neon_pulse,
  impact_frame (golpes ritmados com hold-frames), chromatic_glitch
  (aberração RGB + scanlines), comic_wipe (painéis de quadrinho + halftone),
  kinetic_mask (revelação por máscara, palavra a palavra), counter_rich
  (contador com easing escolhível + prefixo/sufixo), logo_stinger (bumper de
  abertura). Pacote cinema r16 (coreografia adaptada do HyperFrames
  Apache-2 — ver NOTICE.md): cinema_lower (lower-third dark glass com filete
  dourado e shine), comment_card (comentário com avatar e likes — countTo é
  o número), follow_cta (botão FOLLOW→FOLLOWING com elastic — countTo é
  seguidores), music_card (card de música com vinil e progresso), post_card
  (print de post com selo verificado — headline é o texto, subline é o
  @handle), anamorphic_flare (streaks azuis com bloom aditivo — o look
  cinema), liquid_glass (cápsula frost iOS com specular vagueando).
  Parâmetros de física — intensity (0.25 suave a 2 agressivo),
  easing (expo/back/spring/elastic/cubic), direction (left/right/up/down) —
  vão em `code_inject_to_timeline_track` e em `timeline_update_clip`
  (motion_intensity/motion_easing/motion_direction)
- Animação de entrada em clipes NORMAIS: `timeline_apply_transition` com
  kind=entrance_animation — fadeIn ("Fade Suave"), spinIn ("Giro 360°"),
  zoomIn, popIn, typewriter… em qualquer clipe (vídeo, imagem, legenda),
  duration 0.1–3 s. Com kind=transition, a mesma tool anima a JUNÇÃO com o clipe
  anterior (dissolve, slide, wipe, zoom, flash, blur + as 8 do Pacote
  Cinema)
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

## Os olhos — capture e VEJA o frame (`timeline_capture_frame`)

Você EDITA VENDO, não no escuro. O relatório `timeline_audit_visual`
traz `capture_address` em cada achado (ex: `clip_3@12.34`) — passe-o
INTEIRO em `timeline_capture_frame` e o resultado chega com o frame do
momento sinalizado em `bulk.image_base64` (JPEG ≤640px, ≤64KB — decodado
do FONTE no disco, pronto pra você OLHAR). O loop é REGRA de trabalho,
não sugestão:

```
timeline_audit_visual  →  para cada achado: timeline_capture_frame
(o capture_address dele)  →  VEJA o frame  →  corrija com as tools de
edição  →  timeline_audit_visual de novo (re-audit)
```

O que você vê é o frame do VÍDEO FONTE naquele segundo — o fundo onde a
legenda/overlay senta (contraste, espaço, movimento). A composição
renderizada segue descrita pelo relatório: posições, contraste e timing
foram medidos pelos checks. Achado de legenda/código resolve sozinho pro
vídeo ATIVO sob ele. Tetos honestos: 8 decodes por janela de 180s (cache
não conta — mesma fonte+tempo = mesmo frame, reutilize), largura máx.
640px; a recusa do teto ensina a priorizar (achados severity=erro
primeiro).

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
7. **Legendas: pergunte o ESTILO antes.** Se o usuário pedir legendas SEM
   especificar o estilo, use `session_ask_clarification` com 4-5 opções
   descritas (ex.: hormozi — caixinha por palavra amarelo/preto estilo
   TikTok; karaoke suave — palavra ativa muda de cor; cinema-box — caixa
   translúcida; amarelo classico — contorno preto no rodapé). Só aplique o
   preset DEPOIS da resposta. Em Shorts 9:16, position default = "top"
   (acima da cabeça); vídeo horizontal = "bottom". (Se o usuário trouxer uma skill de estilo
   própria — colada no chat ou importada no app — ela manda no
   ESTILO; este contrato manda nas ferramentas.)
8. **Legendas existentes são editáveis individualmente.** Leia com
   `timeline_get_clips` (kind=caption traz o texto de cada caixinha + id),
   corrija texto/tempo/posição com `timeline_update_clip` — não regenere
   tudo quando bastar ajustar um clipe.
9. **Motion graphics: pergunte o ESTILO antes.** Se o usuário pedir
   motion graphic/título animado sem especificar, proponha 3-4 templates do
   catálogo com uma linha do que cada um faz (em Shorts, os de impacto —
   zoom_punch, impact_frame, kinetic_mask — rendem mais; para estatística,
   counter_rich; para abertura, logo_stinger). Se pedir "mais agressivo" ou
   "mais suave", ajuste motion_intensity (0.25 a 2) e o easing em vez de
   trocar de template às cegas — o usuário vê o resultado na preview.

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
