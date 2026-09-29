# Diagnóstico de ruas e Bézier — tasks #325–#331

Data: 2026-09-29. Task: TASK-324-ROAD-EDITOR-STABILITY. Base observada: ea9b3d9b, master após merge humano do PR #323. Este relatório registra diagnóstico técnico; não constitui aceite visual nem conclusão das sete tasks.

## Base confirmada

A base já integra TransformControls do Three.js pelo backend render-3d, com API Grafting, e a ferramenta de rua unifica criação por pontos e desenho livre. O handoff registra aprovação anterior de reinterpolação automática ao mover âncoras de ruas por pontos, preservação de curvas livres, gizmo XYZ, ramificação por Shift e pelo auxiliar +. A troca de modo cancela o rascunho. Não há autorização específica para mudar essa política ou estender esta rodada a paredes.

## Verificação executada

- VTT: baseline de 846 testes; após as mudanças, 857 testes aprovados por graft_task_test, alvo pnpm nx run vtt:test --skip-nx-cache --excludeTaskDependencies.
- render-3d: baseline de 74 testes; após ampliar regressões de lifecycle, 78 testes aprovados por graft_task_test, alvo pnpm nx run render-3d:test --skip-nx-cache.
- A primeira execução com cache Nx falhou ao materializar artefatos no Windows, erro 1314. A execução sem cache passou sem alterar controles de segurança.
- Matriz adicional executada em processo Node com sessionFixture e pathBrushTool reais, WASM existente reconstruído pelo alvo VTT. Cada caso começa numa sessão vazia, creationMode points; bedWidth 0.6, exceto shortWide com 8. Cliques recebem XYZ, seguido de Enter. Coordenadas dos nós confirmados foram inspecionadas.

## Baseline antes das correções

| Caso | Pontos XYZ | Resultado observado |
|---|---|---|
| Linha | (-8,0,0), (0,0,0), (8,0,0) | 2 curvas; 3 âncoras exatas; 1 superfície |
| S | (-8,0,-4), (-3,0,4), (3,0,-4), (8,0,4) | 3 curvas; 4 âncoras exatas; 1 superfície |
| U | (-4,0,0), (-4,0,6), (4,0,6), (4,0,0) | 3 curvas; 4 âncoras exatas; 1 superfície |
| Espaçamento desigual | (-10,0,0), (-9.9,0,0.1), (0,0,4), (20,0,0) | 3 curvas; 4 âncoras exatas; 1 superfície |
| Elevação | (-8,0,0), (0,5,4), (8,0,0) | 2 curvas; altura central 5 preservada; 1 superfície |
| Clique repetido | (-4,0,0), (-4,0,0), (4,0,0) | Repetição ignorada; 1 curva e 2 âncoras |
| Mesmo XZ, altura distinta | (-4,0,0), (-4,4,0), (4,4,0) | Segundo ponto descartado silenciosamente; confirma uma curva de (-4,0,0) a (4,4,0) |
| Trecho curto/largo | (0,0,0), (0.1,0,0.1), (0.2,0,0), largura 8 | 2 curvas, 2 superfícies; finitude não demonstra validade visual da faixa |

Todos os nós resultantes têm coordenadas finitas. Sucesso da operação não demonstra ausência de auto-interseções, costura correta, qualidade visual ou estabilidade do mouse. Tempos isolados são afetados por aquecimento WASM e não são benchmark de picking/render.

## Defeito reproduzido e correção proposta

O caso com XZ igual e Y diferente descarta autoria vertical sem feedback. O core automatic_path usa distância XZ e não representa um segmento puramente vertical. A correção mínima deve explicitar o limite no gesto e preservar o rascunho anterior, sem trocar a parametrização para XYZ ou migrar dados. Confirmar por regressão que clique realmente repetido continua sem duplicação, altura inválida não vira outra rua e erro/cancelamento preserva estado confirmado. Correção implementada: a cadeia candidata é validada pelo comando Rust automatic antes de substituir o rascunho; pontos próximos escolhidos explicitamente não são removidos. A regressão com WASM confirma erro para segmento vertical, preservação da prévia anterior e recuperação por um clique válido.

## Evidência visual e roteiro pendente

CUA retornou browsers vazios; tentativa explícita de abrir iab retornou Browser is not available: iab. Não foi aberta cena nem observada aparência. A porta 4512 não foi tratada como versão desta task. A prévia histórica 4513 também não foi validada.

Quando houver navegador, iniciar a versão desta worktree em uma porta identificada e usar mesa sintética própria. Registrar commit/build, navegador, zoom e hardware. Repetir linha/S/U, seleção e hover, gizmo XYZ, inserção/movimento/remoção, extremos/junções, zoom, duas ruas em alturas diferentes, Esc, pointercancel/perda de captura, troca de ferramenta/mesa, undo/redo, recarga e interação com inputs. Confirmar um dono do gesto e recuperação da câmera. Medir picking, matemática e render separadamente. Aceite visual do dono necessário para encerrar #331/#324.

## Correções e novas regressões

Foram corrigidos dois comportamentos: descarte de pontos por proximidade e prévia por segmentos retos no modo por pontos. A prévia usa as mesmas curvas automáticas Rust da confirmação e ribbons calculadas pelo core; entradas inválidas de hover aparecem em vermelho, sem mutar o rascunho. A prévia é uma faixa amostrada da largura central, não a união final completa de acostamentos, junções e interação com terreno.

Foram acrescentadas regressões reais-WASM para preservação de pontos próximos, rejeição recuperável de altura com XZ coincidente, matriz linha/S/U/espaçamento/elevação/curva curta larga, malhas finitas com índices válidos, preservação integral de outra rua desconectada e igualdade entre ribbon da prévia e espinha confirmada. O gizmo oficial ganhou testes de pointercancel, lostpointercapture, substituição de alvo e release duplicado. Testes focados aprovados: 49 de sessão, 7 de prévia e 7 de manipulador.

## Estado das entregas

#325 tem baseline numérica, duas falhas corrigidas e roteiro visual pendente. #326/#327/#329 têm implementação prévia e regressões ampliadas nesta entrega. A pesquisa #328 está em road-generation-component-review.md, com fontes primárias verificadas e comparação com a base atual. #330 melhora a coerência da prévia e preservação de autoria; a unidade de regeneração continua sendo o componente conectado, sem promessa de atualização mínima por segmento. #331 permanece sem evidência visual, métricas de picking/render ou aceite do dono. Nenhuma das sete issues foi fechada nesta rodada.

## Custo medido da prévia

Medição Node/WASM, sem navegador ou renderer: nove pontos autorados, largura 0.6, 20 hovers de aquecimento e 200 hovers medidos. Cada hover estende a mesma cadeia com um cursor variando X de 8 a 8.219, Y=0 e Z=-2. Tempo total do handler: mediana 0.280 ms, p95 0.491 ms, máximo 1.068 ms. Soma dos comandos curveBatch Rust por hover: mediana 0.229 ms, p95 0.397 ms, máximo 0.828 ms. Não inclui picking de tela, GPU, renderização ou latência do usuário; não é orçamento acordado nem promessa para redes maiores.

## Remoção dos botões de geração

O botão superior Criar rua daqui foi removido. O + verde junto ao ponto selecionado é o handle de criação de novas ruas a partir da espinha e permanece disponível, com seu registro visual, picking e início de ramificação. Sua remoção anterior foi um erro de interpretação, corrigido a pedido do dono. As instruções do painel e regressões cobrem esse handle, incluindo criação e cancelamento. A prévia desta worktree é servida em http://127.0.0.1:4514/table/road-stability-324; HTTP 200 não constitui validação visual.
