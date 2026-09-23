# Rua Bézier: traçado livre e precisão

**Traçado livre** é o padrão para uso durante o jogo. Arraste para desenhar a espinha da rua, veja a largura na prévia e solte para construir em uma transação reversível. A prévia verde indica um traçado que pode gerar a faixa; vermelho indica falha na prévia. O ajuste final é recalculado ao soltar: uma prévia antiga nunca é usada no lugar de uma entrada final inválida.

Arraste sobre uma rua existente para puxar sua espinha pelo ponto mais próximo do clique. O deslocamento preserva a distância entre o clique e a espinha para evitar um salto inicial. Perto das extremidades, o gesto move a âncora. Cliques e movimentos abaixo de cinco pixels não iniciam a edição; Esc cancela sem mutação. A consulta de proximidade vem do Rust e os candidatos são separados por altura.

**Precisão: pontos e alças** preserva a construção ponto a ponto: clique para adicionar uma âncora, arraste para definir alças, Enter confirma, Backspace remove a última e Esc cancela. Clicar junto à primeira fecha a curva. Nesse modo, clicar no ponto central subdivide um trecho e o painel oferece as restrições das alças.

Ambos os modos usam a mesma ferramenta de rua, a mesma espinha Bézier e o mesmo fluxo de regeneração da superfície. O traçado livre usa o ajuste Rust com tolerância de 0,12 unidades e supressão de cantos menores que 100 graus. A transação permanece somente no fim do gesto.

## Fronteiras

- `packages/render-3d/src/interaction/curve-pen.ts` mant?m apenas o ciclo de intera??o, independente do renderer, da geometria e de pol?ticas de teclado ou apar?ncia. Confirma??es recusadas preservam o rascunho.
- A composi??o do VTT transforma ?ncoras em comandos do port B?zier e previews do renderer existente. Os controles s?o enviados ao fluxo da espinha sem passar novamente pelo ajuste do pincel.
- O Rust em `grafting-graph-core` calcula al?as, amostras, conex?es e contornos. Al?as recolhidas nos extremos usam a dire??o tangente unilateral; c?spides interiores estacion?rias continuam sendo recusadas.
- Cada cria??o aceita corresponde a uma transa??o revers?vel do caminho. O controlador ? reutiliz?vel; o consumidor conectado nesta entrega ? a ferramenta de caminho. N?o h? novo gerador de ruas nem altera??o da pol?tica de largura.

## Refer?ncias de intera??o

A pesquisa anterior usou [pen-tool](https://github.com/BenjaminDobler/pen-tool) como refer?ncia para clique, arraste e fechamento e [dollycurve](https://github.com/jtydhr88/dollycurve) para edi??o de caminhos numa cena Three.js. Esta implementa??o n?o incorpora c?digo desses projetos nem acrescenta depend?ncias.

## Verifica??o

Os testes do controlador exercitam confirma??o ?nica, fechamento somente no release, hover transit?rio, cancelamento, remo??o de ?ncora e retomada ap?s recusa. Os testes de sess?o executam o WASM real para preservar controles, criar curvas abertas/fechadas e desfazer/refazer. Os testes de gesto cobrem espinha e contorno; os testes Rust cobrem al?as recolhidas e tangentes inv?lidas.
