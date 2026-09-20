# Caneta e edi??o B?zier

A op??o **Caneta B?zier** no painel da ferramenta de caminho cria um rascunho na cena. Clique para adicionar uma ?ncora de canto; arraste para definir as duas al?as espelhadas. Enter confirma um caminho aberto, Backspace remove a ?ltima ?ncora e Esc descarta o rascunho. Com pelo menos tr?s ?ncoras, clicar novamente junto ? primeira fecha a curva. Trocar ferramenta, par?metros ou mesa tamb?m cancela o rascunho.

A edi??o existente usa as mesmas al?as para espinhas e contornos curvos. O ?ltimo ponto do pointer-up ? considerado. Um clique numa al?a, uma ida e volta ? posi??o original ou um cancelamento n?o alteram a geometria; clicar no meio de uma espinha continua inserindo uma ?ncora. As regras de cada estrutura continuam determinando quais contornos podem ser remodelados.

## Fronteiras

- `packages/render-3d/src/interaction/curve-pen.ts` mant?m apenas o ciclo de intera??o, independente do renderer, da geometria e de pol?ticas de teclado ou apar?ncia. Confirma??es recusadas preservam o rascunho.
- A composi??o do VTT transforma ?ncoras em comandos do port B?zier e previews do renderer existente. Os controles s?o enviados ao fluxo da espinha sem passar novamente pelo ajuste do pincel.
- O Rust em `grafting-graph-core` calcula al?as, amostras, conex?es e contornos. Al?as recolhidas nos extremos usam a dire??o tangente unilateral; c?spides interiores estacion?rias continuam sendo recusadas.
- Cada cria??o aceita corresponde a uma transa??o revers?vel do caminho. O controlador ? reutiliz?vel; o consumidor conectado nesta entrega ? a ferramenta de caminho. N?o h? novo gerador de ruas nem altera??o da pol?tica de largura.

## Refer?ncias de intera??o

A pesquisa anterior usou [pen-tool](https://github.com/BenjaminDobler/pen-tool) como refer?ncia para clique, arraste e fechamento e [dollycurve](https://github.com/jtydhr88/dollycurve) para edi??o de caminhos numa cena Three.js. Esta implementa??o n?o incorpora c?digo desses projetos nem acrescenta depend?ncias.

## Verifica??o

Os testes do controlador exercitam confirma??o ?nica, fechamento somente no release, hover transit?rio, cancelamento, remo??o de ?ncora e retomada ap?s recusa. Os testes de sess?o executam o WASM real para preservar controles, criar curvas abertas/fechadas e desfazer/refazer. Os testes de gesto cobrem espinha e contorno; os testes Rust cobrem al?as recolhidas e tangentes inv?lidas.
