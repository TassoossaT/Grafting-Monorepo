# Refinamento do menu e das interações de construção

Status: proposta de produto para revisão do dono; não implementada.
Escopo: evolução do editor unificado, ligada a #329 e #330. A entrega existente continua no commit 4c479ac5 até a implementação deste refinamento.
Referência: [Planet Coaster 2 — Pathing Guide oficial](https://www.youtube.com/watch?v=qfhXDpwAg-c). Os gestos abaixo são proposta para Grafting, não transcrição dos controles do jogo.

## 1. Organização do menu

Três escolhas visíveis: família de construção → ferramenta/subitem → ajustes. Exemplo: Caminhos → Linha → Curva, largura e altura. Nenhum submenu depende apenas de hover; clicar seleciona, com nome e estado ativo visíveis.

As famílias ficam numa barra lateral compacta. Ao selecionar uma, um painel mostra seus subitens. O inspetor mostra ajustes da ferramenta ou da seleção. Não abrir gavetas sucessivas para trocar entre Linha, Área, Carimbo e Editar.

| Família | Subitens propostos | Ajustes específicos |
|---|---|---|
| Caminhos | Linha, Área pavimentada, Carimbo, Editar | Largura, perfil, altura, encaixes |
| Pisos e plataformas | Área, Carimbo, Rampa, Editar | Altura, espessura, inclinação quando aplicável |
| Paredes | Linha, Contorno fechado, Carimbo, Editar | Altura, espessura, aparência |
| Coberturas | Contorno, Carimbo, Transição, Editar | Altura, inclinação e forma admitida |
| Aberturas | Posicionar abertura, Editar | Largura, altura, posição no suporte |
| Terreno | Elevar/rebaixar, Nivelar, Suavizar | Raio, intensidade, altura alvo quando aplicável |

Este mapa é o destino de produto, não a lista de capacidades já prontas. Subitens só entram na interface quando têm fluxo funcional e são admitidos pelas capacidades do tipo. Não oferecer Linha/Carimbo/Edição de pontos para terreno só para uniformizar o menu. Não criar um novo tipo para cada forma de carimbo ou ferramenta.

Assets e modelos permanecem na área de assets. Uma forma geométrica de carimbo não é um modelo de asset. Variações visuais pertencem ao perfil/aparência e não precisam duplicar ferramentas.

## 2. Caminhos: subitens e modos

| Subitem | Modos/ações internos | Resultado |
|---|---|---|
| Linha | Reta, Curva, Desenho livre | Faixa gerada a partir de espinha |
| Área pavimentada | Contorno por pontos, Contorno livre | Região preenchida, adequada a praças e encontros largos |
| Carimbo | Retângulo, Círculo, Polígono regular | Região com tamanho e rotação ajustáveis |
| Editar | Espinha, Bordas, Perfil | Alterar autoria e perfil da seleção compatível |

Linha/Curva é o fluxo inicial proposto. Desenho livre é uma opção explícita: soltar o mouse confirma somente nesse modo. Retas e curvas usam cliques com prévia; não misturar gestos implicitamente.

## 3. Linha por cliques

1. Escolher Linha e Reta ou Curva.
2. Clicar no terreno define a origem; mover o cursor mostra a faixa e a espinha até o destino candidato, sem segurar o botão.
3. Em Reta, o clique seguinte confirma o segmento.
4. Em Curva, o segundo clique define a guia de direção/curvatura; mover o cursor ajusta a curva e o terceiro clique confirma o destino. A guia é visualmente distinta de uma âncora de autoria.
5. O destino confirmado vira a origem da continuação. A próxima prévia começa ali; cada confirmação gera uma operação desfeita individualmente.
6. Enter encerra a sequência entre segmentos. Enter não confirma uma curva incompleta.
7. Esc cancela a proposta do segmento atual; Esc sem proposta encerra a ferramenta. Segmentos confirmados só saem com Desfazer ou Remover.

Reta e Curva podem ser alternadas entre segmentos mantendo a última ponta como origem. Se há uma proposta incompleta, a mudança de modo descarta somente essa proposta e mantém a origem. Um ponto-guia nunca vira automaticamente uma âncora persistida.

## 4. Desenho livre

Pressionar no terreno, desenhar segurando o botão e soltar confirma um traçado válido. Um clique sem movimento não deixa uma origem pendente neste modo. Esc durante o arraste cancela. A prévia usa a mesma interpretação geométrica da confirmação.

## 5. Continuação e ramificação pelo +

O + verde existente é preservado. Ele inicia a ferramenta Linha na posição real da espinha, usando o perfil e o modo de criação escolhidos. O deslocamento visual do ícone não altera a origem geométrica.

- Em Reta/Curva, clicar no + inicia a prévia acompanhando o cursor; o usuário continua pelos cliques descritos acima.
- Em Desenho livre, pressionar e arrastar o + cria a ramificação em um gesto.
- Numa ponta, o gesto continua o percurso; num ponto interno, ramifica. O rascunho evidencia qual operação será feita.
- Se a conexão nasce no interior de um segmento, a divisão precisa preservar sua forma e acontecer na mesma confirmação da nova construção.
- Não mostrar botão superior Criar rua daqui. Os subitens do menu selecionam ferramentas; a posição de criação é escolhida na cena.

## 6. Áreas e carimbos

Área por pontos: clicar adiciona vértices do contorno. A prévia mantém o preenchimento candidato e a borda de fechamento visíveis. Clicar no primeiro ponto fecha e confirma um contorno válido; Enter fecha pelo mesmo caminho de confirmação. Backspace remove o último ponto candidato. Esc cancela somente a área não confirmada.

Área livre: desenhar o contorno segurando o botão; soltar cria um contorno candidato fechado, com handles para ajuste. Enter confirma; Esc cancela. Soltar não confirma áreas, para permitir revisar fechamento e cruzamentos.

Carimbo: escolher a forma, posicionar a prévia, ajustar dimensões e rotação e clicar para aplicar. A ferramenta permanece ativa para repetir. Cada aplicação é uma operação. Esc abandona a próxima prévia. Círculo não deve se transformar em uma longa coleção de handles de autoria; expor controles de centro e tamanho.

Ao aproximar área ou carimbo de uma construção, mostrar o alvo e o efeito proposto: conectar/unir, sobrepor ou ficar separado. União só é admitida quando perfil, altura e regras do tipo forem compatíveis. Não alterar construções confirmadas durante o hover. Uma praça conectada precisa ter edição e persistência de região próprias; não representar o contorno como uma espinha de rua escondida.

## 7. Seleção e edição

Acesso direto: clicar no corpo de uma construção existente seleciona e abre seu inspetor. O subitem Editar ativa seleção explícita, útil numa cena densa. Selecionar não insere ponto nem inicia criação.

- Espinha: mover âncoras, ajustar handles de curva, inserir âncora e remover quando permitido.
- Bordas: mover vértices/arestas de regiões compatíveis, inserir/remover vértices e ajustar cantos.
- Perfil: alterar largura, altura, espessura ou aparência conforme o tipo e o alcance declarado.
- Alcance sempre escrito: Trecho selecionado, Construção selecionada ou Rede conectada. Expandir para a rede deve ser escolha explícita; não mudar silenciosamente todos os trechos ao selecionar um ponto.
- Sem seleção: parâmetros configuram a próxima criação. Com seleção: o painel identifica o objeto e o alcance que será alterado.
- Arrastar um handle mantém proposta reversível; confirmar o arraste produz uma operação. Erro restaura o estado confirmado e mantém a seleção útil.

## 8. Feedback e consistência

Sempre mostrar família, ferramenta e modo ativos. A linha de ajuda muda por etapa: Escolha a origem, Defina a direção, Escolha o destino, Feche o contorno ou Posicione a forma.

A prévia exibe espinha/contorno, preenchimento, handles relevantes e encaixe candidato. Só mostrar controles úteis à operação ativa, com rótulo ao focar/hover. Seleção, rascunho válido e rascunho inválido têm estilos distintos, acompanhados de texto; a cor sozinha não comunica estado.

Informações de comprimento, largura, altura e inclinação aparecem quando pertinentes. Prévia inválida explica o impedimento e não confirma uma proposta válida anterior. Alturas distintas não conectam automaticamente só porque se cruzam em planta.

Backspace atua no rascunho; Delete atua na seleção quando não há rascunho. Desfazer atua em operações confirmadas. Trocar de família descarta apenas a proposta pendente, remove seus ghosts/handles e preserva construções confirmadas. A UI informa esse descarte. Não criar estados pendentes invisíveis entre ferramentas.

## 9. Relação com a implementação atual

O catálogo canônico atual declara caminhos, plataformas, rampas/plataformas inclinadas, paredes, coberturas/transições, aberturas e terreno. A lista de famílias apenas organiza esses produtos na interface.

A implementação atual tem autoria de espinha, handles, prévia, edição e transações. O fluxo de clique inicial seguido de outro arraste está rejeitado pelo dono. A versão visível ainda tem esse fluxo até a revisão ser implementada.

Áreas pavimentadas associadas a caminhos, carimbos conectados e edição por borda precisam de integração e validação próprias. Esta proposta não os declara implementados. Compatibilidade de junções entre faixa e região exige análise do contrato vigente antes de código; qualquer decisão estrutural OPEN continua aberta.

O menu deve ser projetado a partir das capacidades declaradas pelo tipo e usar dispatchers comuns. Geometria e consultas reutilizáveis ficam no Rust; preview e commit não podem ter algoritmos geométricos independentes. Não modificar APIs públicas sem baseline e api-check.

## 10. Ordem de implementação e aceite

1. Navegação família/subitens, inspetor contextual e Linha Reta/Curva com continuação por cliques; preservar +, edição existente e undo/redo.
2. Área pavimentada e conexão faixa/região, com autoria e edição válidas.
3. Carimbos geométricos e edição de bordas/cantos.
4. Projetar os mesmos subitens nas demais famílias somente conforme suas capacidades; integração de aparência/modelos segue assets.

Aceite: criar uma reta e uma curva sem arraste separado; continuar vários segmentos; ramificar pelo + sem deslocamento da origem; conectar com encaixe claro; cancelar sem deixar ghosts; desfazer cada confirmação; editar perfil com alcance explícito; criar praça por contorno e carimbo; mover borda mantendo conexões válidas; rejeitar contorno inválido sem perder autoria.

A revisão de produto vem antes da implementação. Não publicar ferramentas vazias ou anunciar os fluxos acima como entregues.
