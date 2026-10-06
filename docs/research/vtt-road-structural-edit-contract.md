# Contrato estrutural das ruas — #315

Decisões confirmadas pelo dono em 2026-10-06. Materiais, pintura, mão de trânsito, simulação de veículos e assets estão fora deste trabalho.

## Referências verificadas

| Tema | Referência primária | O que a referência oferece |
|---|---|---|
| Conexões e edição | [Epic: Landscape Splines](https://dev.epicgames.com/documentation/en-us/unreal-engine/landscape-splines-in-unreal-engine) | Pontos ligados por segmentos; junção entre splines; inserção de ponto por divisão de segmento; edição das tangentes; largura e transição nas extremidades. |
| Relevo | Epic, mesma página, seção Applying Splines to the Landscape | O terreno pode subir ou baixar para acompanhar a spline; largura e falloff controlam o entorno. |
| Traçado e elevação | [Paradox: Road Tools](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/road-tools) | Ferramentas de curva, encaixe, guias e medida numérica da inclinação. |

A aplicação abaixo é uma decisão de produto do Grafting, não uma reprodução integral dessas ferramentas.

## Comportamento definido

| Tema | Contrato | Fonte canônica no projeto |
|---|---|---|
| Verdade da rua | Uma superfície gerada por uma espinha Bézier; receitas definem a seção inicial e a espinha governa a regeneração. | `path-structure.ts`, `bezier-road-edit.ts` |
| Pontas e cruzamentos | Pontas e interseções na mesma cota formam uma conexão topológica, com nó compartilhado e superfície unificada. Proximidade visual não substitui o vínculo. | Rede de curvas do motor, `path-cloud-mutation.ts` |
| Cruzamento elevado | Vias em cotas diferentes permanecem separadas. Passar por cima não cria uma junção. | Consultas da rede de curvas e leis de contato com terreno |
| Relevo | O traçado acompanha o relevo usando os limites existentes de inclinação, raio e tolerância de altura. A edição respeita esses limites. | `path-recipe.ts`, `path-structure.ts` |
| Elevação | Elevar a espinha produz um tabuleiro; o terreno fica livre por baixo onde não há contato. A elevação pertence à estrutura. | `ground-contact.ts`, reações do terreno |
| Ligação entre cotas | Rampas ligam níveis; sua própria espinha e suas alças controlam forma e elevação. | Tipos de plataforma inclinada e editor genérico de espinha |
| Forma e largura | Arrastar âncora ou meio do trecho altera a curva; duplo clique insere âncora. Largura tem alça no trecho e no fim, permitindo afunilamento. | `spine-edit-behavior.ts`, `spine-handles.ts` |
| Desconectar, apagar, fechar | Ações em alças contextuais na curva ou nas pontas selecionadas. Remover âncora também usa Delete. | #350, `scene-handles.ts` |
| Remoção | Remove a superfície e sua espinha de criação; o terreno responde pelo contrato do tipo. Um passo de desfazer restaura o conjunto. | #291, `effect-commit.ts` |

## Limites desta entrega

O refinamento consolida o comportamento estrutural existente e a edição das #291 e #350. Não encomenda novos geradores de pontes, pilares, rotatórias, túneis ou redes de trânsito. Assets e materiais permanecem fora do escopo confirmado pelo dono. A adaptação visual a terrenos editados continua sob as leis já existentes; a ferramenta de edição de terreno está sendo tratada pelo dono.
