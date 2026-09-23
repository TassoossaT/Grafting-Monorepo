# Ferramenta unificada de rua Bézier

A ferramenta **Caminhos / Rua Bézier** cria e ajusta a rua pelo mesmo gesto contextual. Não há escolha entre pincel de área e caneta: mesmo preferências antigas com `creationMode: "brush"` passam pelo autor de curvas.

Em espaço livre, clique para adicionar uma âncora; arraste para definir suas alças espelhadas. Enter confirma, Backspace remove a última âncora e Esc cancela. Com pelo menos três âncoras, clicar junto à primeira fecha a curva. A superfície é gerada da espinha e de seu perfil, sem pintar uma área com o arraste.

Sem um desenho pendente, arraste os pontos ou as alças de uma curva existente para editá-la na mesma ferramenta. Clique no ponto central de uma espinha para subdividir o trecho sem mudar sua forma. O painel oferece alças espelhadas, alinhadas, livres e automáticas. Um rascunho pendente continua aceitando pontos de conexão; confirme ou cancele antes de manipular a curva existente.

O arraste de edição usa uma prévia e grava uma única transação ao soltar. A posição final do pointer-up é considerada. Cancelar ou voltar à posição inicial não altera a geometria. Trocar ferramenta, parâmetros ou mesa descarta a interação pendente.

## Fronteiras

- `packages/render-3d/src/interaction/curve-pen.ts` mant?m apenas o ciclo de intera??o, independente do renderer, da geometria e de pol?ticas de teclado ou apar?ncia. Confirma??es recusadas preservam o rascunho.
- A composi??o do VTT transforma ?ncoras em comandos do port B?zier e previews do renderer existente. Os controles s?o enviados ao fluxo da espinha sem passar novamente pelo ajuste do pincel.
- O Rust em `grafting-graph-core` calcula al?as, amostras, conex?es e contornos. Al?as recolhidas nos extremos usam a dire??o tangente unilateral; c?spides interiores estacion?rias continuam sendo recusadas.
- Cada cria??o aceita corresponde a uma transa??o revers?vel do caminho. O controlador ? reutiliz?vel; o consumidor conectado nesta entrega ? a ferramenta de caminho. N?o h? novo gerador de ruas nem altera??o da pol?tica de largura.

## Refer?ncias de intera??o

A pesquisa anterior usou [pen-tool](https://github.com/BenjaminDobler/pen-tool) como refer?ncia para clique, arraste e fechamento e [dollycurve](https://github.com/jtydhr88/dollycurve) para edi??o de caminhos numa cena Three.js. Esta implementa??o n?o incorpora c?digo desses projetos nem acrescenta depend?ncias.

## Verifica??o

Os testes do controlador exercitam confirma??o ?nica, fechamento somente no release, hover transit?rio, cancelamento, remo??o de ?ncora e retomada ap?s recusa. Os testes de sess?o executam o WASM real para preservar controles, criar curvas abertas/fechadas e desfazer/refazer. Os testes de gesto cobrem espinha e contorno; os testes Rust cobrem al?as recolhidas e tangentes inv?lidas.
