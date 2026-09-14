# Muro sobre eixo Bézier — #282

O tipo `muro` é criado pela ferramenta **Muro**, com altura e espessura
ajustáveis. O usuário desenha seu eixo como nas ruas; os nós e as alças Bézier
continuam sendo a representação editável, persistida no grafo. Os painéis
gerados são uma projeção desse eixo, não uma segunda receita autoritativa.

## Comportamento acordado

- A base acompanha o terreno e o terreno com grama, na criação e em cada
  regeneração após editar o muro. Cada vértice do topo mantém a altura
  escolhida acima de seu correspondente na base.
- Onde não existe terreno, vale a elevação do eixo desenhado.
- Muro e rua não interagem nesta versão, em nenhuma ordem de criação:
  não há união de eixos, recorte ou abertura automática de passagem.
- Os demais encontros do muro também não geram recortes automáticos.
- Reparos após recorte ficam declarados como preservação, pois o muro
  não participa dessas interações nesta versão.

## Criação e edição

`planMuroCreation` usa o ajuste de curvas em Rust já consumido pelas ruas.
`planMuroEdit` usa o mesmo planejador de edição do eixo: mover nós e alças,
inserir ou remover âncoras, desconectar e excluir trechos, fechar um percurso
e alterar a espessura de um trecho. **Altura do muro**, seguida de um clique
no eixo, ajusta a altura de todo o muro.

Cada muro desenhado tem identidade própria. Suas faces registram a identidade
e a altura, e seus eixos registram os controles e os perfis laterais. Ao
editar, somente as faces pertencentes a esse muro são substituídas, junto com
a alteração do eixo, em uma transação reversível. A prévia não altera a sessão;
cancelar não envia operação. Os vértices da tesselação não geram alças de edição.

## Geração e fronteiras

`grafting-graph-core` expõe `ExtrudeRibbon`, uma operação genérica sobre
curvas e polígonos de suporte. Ela amostra as duas laterais, projeta sua base
nos polígonos de terreno triangulados respeitando buracos, gera topo, laterais
e tampas e devolve vértices e limites de faces com arestas compartilhadas.
O aplicativo seleciona quais superfícies são terreno e atribui identidades e
o tipo `muro` à geometria resultante. Nenhum cálculo geométrico é duplicado no
aplicativo.

`muro` tem definição própria porque seu eixo persistente e a regeneração da
espessura diferem dos painéis desenhados por contorno. A edição direta de um
triângulo é recusada com orientação para usar o eixo e o controle de altura.

A conformidade é amostrada; alterações posteriores do terreno, sem uma edição
do muro, não disparam regeneração automática nesta entrega. Entradas excessivas,
dimensões inválidas e tangentes estacionárias são recusadas sem modificar a sessão.

## Verificação

Os testes Rust verificam projeção sobre inclinação, altura constante, buracos
no suporte, largura variável, continuidade e duas utilizações opostas por
aresta da extrusão fechada. Os testes com a sessão WASM verificam criação,
edição, exclusão, desfazer, isolamento de outros muros e ruas e cancelamento
de gestos.
