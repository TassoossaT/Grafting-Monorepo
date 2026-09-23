# Rua Bézier: desenho livre e por pontos

A mesma ferramenta de rua cria e edita caminhos. O seletor de construção oferece:

- **Desenho livre:** arrastar pelo terreno e soltar confirma uma operação. O Rust converte as amostras em curvas, com tolerância de 0,12 unidades. Não há detecção adicional de cantos, correção inteligente ou encaixe na grade.
- **Por pontos:** cada clique marca uma posição pela qual a curva passa. O comando Rust `automatic` interpola esses pontos em cúbicas; não remove nem desloca os pontos escolhidos. Arrastar durante um clique não cria alças. Enter confirma, Backspace retira o último ponto e Esc cancela. Hover mostra apenas a continuação possível.

A ferramenta mostra somente os pontos da espinha e os pontos centrais usados para inserção. Alças tangentes, vértices da malha e suas linhas auxiliares ficam ocultos nesse contexto e reaparecem ao mudar para outras ferramentas.

Arrastar um ponto move a espinha, preservando a distância inicial entre clique e centro do marcador. A prévia não altera a cena confirmada; a superfície é regenerada ao soltar. Clicar no ponto central insere uma âncora por subdivisão exata. Delete remove o ponto selecionado e une os controles restantes, permitindo alterar a forma local. Uma extremidade pode ser removida enquanto restar um caminho com pelo menos dois pontos; cruzamentos não são removidos por essa ação. Clicar ou arrastar o corpo da rua não deforma a curva nem começa outra rua.

A troca de modo ou ferramenta cancela o rascunho atual. Esta versão básica não mistura os dois modos dentro de um rascunho. Criação, movimentação, inserção e remoção usam transações com desfazer/refazer. Erros preservam a cena anterior; uma confirmação recusada no modo por pontos mantém o rascunho disponível.

## Fronteiras

A composição do VTT decide gestos, seleção e apresentação. A matemática de interpolação, ajuste, subdivisão e geração das faixas permanece no núcleo Rust. A representação persistida continua Bézier. O controlador genérico de caneta em render-3d permanece disponível para outros consumidores, mas não dirige a ferramenta de rua.

O [exemplo oficial de spline do Three.js](https://threejs.org/examples/webgl_geometry_spline_editor.html) é referência de interação por pontos, não uma dependência importada. Nenhuma biblioteca nova foi instalada.

## Verificação

Testes com WASM real cobrem posições explícitas, preview transitório, desenho livre, cancelamento, falha de confirmação, movimentação, inserção, remoção e desfazer/refazer. O dispatcher é exercitado com os eventos de ponteiro e teclado. A apresentação dos controles é verificada no runtime. A sensação de uso ainda exige avaliação visual no navegador.
