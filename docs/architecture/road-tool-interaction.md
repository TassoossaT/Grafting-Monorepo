# Interação da ferramenta de rua (modelo Tiny Glade)

Status: decidido com o dono em 2026-09-29; implementado no PR #341. Substitui a proposta anterior baseada no Planet Coaster 2 (menu família → subitem → ajustes).
Escopo: somente rua. Fora: carimbos, área pavimentada/praça, inspetor, submenu Editar, ajuda por etapa, demais famílias.

## Regras centrais

1. **Tiny Glade é a referência.** Nenhum modo explícito de edição; criar e editar acontecem na cena.
2. **Handles são os únicos pontos de edição.** Cada handle terá asset próprio no futuro. O corpo da rua nunca edita.
3. **O corpo da rua é área de criação.** Um traço que começa sobre o corpo se conecta ali.
4. **Nenhum painel de ação.** O painel direito só calibra a próxima rua.

## Criação: gesto inferido

| Gesto | Resultado |
|---|---|
| Clicar e soltar sem mover, depois clicar no destino | Segmento reto. O destino vira a origem do próximo segmento; Esc ou Enter encerra a sequência |
| Pressionar, arrastar e soltar | Traço livre, suavizado pela espinha em Rust |

- Uma tolerância de movimento separa clique de arraste; tremor da mão não vira traço livre.
- Prévia e confirmação usam o mesmo algoritmo em Rust.
- Esc cancela o arraste ou a origem pendente da reta. Cada confirmação é uma operação de desfazer.
- Sem seletor Reta/Curva/Livre, sem cliques de guia de curva.

**Capacidade genérica.** Toda ferramenta de espinha usa a mesma base, `createSpineDraftTool` (`composition/tabletop/tools/core/spine-draft.ts`); os modos são peças (`spine-draft-modes.ts`: reta, arco, pontos, ligar pontas, espiral) e cada ferramenta só configura quais usa, como escolhe o modo, onde a ponta pousa e o que grava. A rua usa um modo de trecho em cadeia mais o traço por arraste (`isStroke`: 5 px ou 0,15 m); a rampa usa os cinco modos com seletor e R (`slope/slope-draft.ts`). A parede ainda não migrou.

## Onde o traço começa

| Ponto inicial | Resultado |
|---|---|
| Handle | Edita (ver abaixo) |
| Corpo da rua, na ponta | Continua o percurso |
| Corpo da rua, no interior | Ramifica; a divisão preserva a forma e acontece na mesma confirmação |
| Terreno vazio | Rua solta |

O **+ verde é removido**. Ele existia porque pressionar o corpo editava em vez de criar; com a regra acima ele fica redundante. Volta se o dono sentir falta.

## Handles

| Handle | Posição | Ação |
|---|---|---|
| Âncora | Pontos da espinha | Mover o ponto |
| Curvatura | Meio de cada trecho entre âncoras | Arrastar entorta o trecho; duplo clique insere uma âncora ali |
| Largura | Borda da faixa | Alargar ou estreitar |
| Altura | Eixo vertical do manipulador da âncora selecionada | Subir ou descer o ponto e os trechos que ele toca |

- O handle de curvatura substitui o arraste do corpo, que deixa de existir. Largura e duplo clique vivem em `spine-edit-behavior.ts`: toda ferramenta de espinha (rua, rampa curva, espiral) os ganha, e nenhuma edita pelo corpo.
- O handle age no trecho onde está. Não há escolha de alcance (trecho/construção/rede).

## Perfil e ponte

- **O perfil estrutural da rua é só a largura.** Meio-fio (`shoulderHeight`, já desligado) é detalhe de asset.
- `trail`, `street` e `road` diferem apenas em largura/acostamento: são parâmetros, não tipos.
- **Ponte não é escolhida.** A rua nunca amostra o terreno entre as âncoras: a altura vem da espinha. A lei de contato com o chão (`topology/ground-contact.ts`, 1,5 m) já corta o terreno só onde a rua se apoia; um trecho erguido acima disso deixa o chão inteiro sob ele, e isso é a ponte. O subtipo `bridge` foi removido de `PathKind`.

## Aceite

- Criar reta por clique-clique e traço livre por arraste, sem seletor.
- Continuar e ramificar começando o traço sobre o corpo, sem deslocar a origem.
- Pressionar o corpo nunca edita; somente handles editam.
- Entortar um trecho pelo handle de curvatura; inserir âncora por duplo clique nele.
- Alterar largura e altura pelos handles; elevar acima de 1,5 m transforma o trecho em ponte.
- Esc não deixa ghosts nem origem escondida; cada confirmação é desfeita individualmente.
