# Política geométrica da espinha Bézier (#327)

Status: auditado em 2026-09-30 no PR #341. Toda a matemática está em Rust (`libs/graph/core`); o VTT só escolhe comandos e grava o resultado.

## Veredito

| Operação | Algoritmo | Contrato | Evidência |
|---|---|---|---|
| Trecho por clique-clique | `interpretStroke` com 2 pontos, `curved: false`, `maxGrade` | Reta entre as pontas; altura limitada à inclinação da rua; vertical não lança nada | `curve-pen-session`: "a span straight up lays nothing…" |
| Traço livre | `interpretStroke` + `stroke_shaping` (laços, raio mínimo, inclinação) | Aproximação dentro de 1 m de tremor; não passa pelas amostras, passa pela forma reparada | `stroke_shaping.rs` tests; `curve-pen-session`: loop, largura, colina |
| Cadeia por pontos (`automatic`) | `automatic_path`: Catmull-Rom centrípeta → cúbicas, nós medidos em **XZ** | Passa por cada âncora exatamente; controles finitos | `bezier.rs`: "an automatic path passes through every anchor finitely"; matriz de estabilidade VTT |
| Mover âncora, espinha `automatic` | Recalcula a cadeia inteira com `withAutomaticHandles` | Os vizinhos reinterpolam; modo continua `automatic` | "an automatic road reinterpolates moved anchors…" |
| Mover âncora, espinha `free` | Mantém os controles relativos | Só os trechos incidentes mudam | "same road tool: anchor drag…" |
| Inserir (duplo clique no meio) | `split` exato em `t` | Forma idêntica antes e depois, dentro de 1e-10 | "a midpoint click only selects; a double-click inserts…" |
| Remover âncora | `merge` dos dois trechos (`remove-anchor`) | Mudança local: só os dois trechos incidentes viram um. Recusa com mensagem em ponta de cadeia única, junção (≠ 2 trechos), perfis diferentes ou circuito que sumiria | `spine-actions.ts`; "road deletion…" |
| Soldar numa rua existente | `smooth_welds` | Só a rua nova se alinha em planta; a existente mantém controles; cada uma mantém sua inclinação | `bezier_network.rs` weld tests; "continuing a road… keeps its contour on its spine" |

## Casos degenerados (declarados, nunca NaN)

- Âncoras vizinhas coincidentes em XZ, mesmo com alturas diferentes: `automatic_path` recusa ("adjacent anchors coincide in XZ"). No traço livre, o saneamento nunca entrega amostras coincidentes; no trecho reto, uma vertical não lança nada.
- Menos de 2 âncoras: recusa.
- Cadeia fechada (primeira = última, 4+ pontos): tangente compartilhada no fechamento.

## XZ versus XYZ

Os nós da parametrização são medidos em XZ de propósito: a altura de uma rua não deve mudar a forma em planta. Consequência aceita: dois pontos na mesma vertical são inválidos (acima). A altura é limitada pela inclinação máxima (`PATH_MAX_GRADE`), não pela parametrização.

## Livre versus cliques

São algoritmos distintos: cliques interpolam (passam pelas âncoras), o traço livre aproxima (tolerância de tremor e leis da rua). Não reunir os dois num só.

## Limites conhecidos

- Inclinação e raio mínimo valem ao criar; arrastar âncora ainda não os aplica.
- A garantia de Yuksel (sem cúspides nem auto-interseção) é local ao trecho; bordas com largura são protegidas pelo raio mínimo apenas na criação.
