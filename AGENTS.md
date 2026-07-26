# AGENTS.md — Contrato operacional do Grafting Monorepo

Este arquivo define como agentes devem trabalhar no repositório.

## Leitura obrigatória

Antes de propor ou executar trabalho estrutural, leia nesta ordem:

1. `GRAFTING_MASTER_SOURCE.md`;
2. `CURRENT_PLANNING_STATE.md`;
3. ADRs relacionados;
4. `AGENTS.md` mais próximo do escopo, quando existir;
5. código, manifests, schemas e Graph IR aplicáveis.

## Estado inicial

Enquanto `CURRENT_PLANNING_STATE.md` informar que o monorepo ainda não existe:

- não trate diretórios planejados como arquivos reais;
- não assuma que Git, CI, Nx, Cargo, pnpm, uv ou .NET já estão configurados;
- não invente resultados de comandos;
- não declare uma implementação concluída;
- produza planos, ADRs, spikes e critérios verificáveis.

## Regras obrigatórias

O agente NÃO DEVE:

- fechar decisão `OPEN` silenciosamente;
- substituir tecnologia `LOCKED`;
- duplicar lógica Rust em TypeScript, C# ou Python;
- expor tipos Rust diretamente pela ABI;
- prometer zero-copy entre domínios distintos;
- chamar replicação autoritativa de Event Sourcing;
- criar segunda raiz de workspace ou lockfile sem ADR;
- usar Nx para substituir toolchains nativas;
- criar a árvore futura inteira vazia;
- introduzir ferramenta, agente, skill ou MCP sem necessidade e avaliação;
- modificar controles de segurança ou a própria manutenção sem aprovação;
- tratar documentos resumidos como superiores à fonte mestre.

## Trabalho por tarefa

Quando existir backlog implementado:

- trabalhar em uma tarefa por vez;
- manter um proprietário por tarefa;
- usar worktree para execução paralela;
- separar implementação de revisão independente;
- preservar alterações não relacionadas.

## Antes de editar

Declare:

```text
Tarefa:
Objetivo:
Decisões aplicáveis:
Decisões abertas:
Arquivos afetados:
Dependências:
Inputs e outputs:
Validações:
Riscos:
```

## Critério de conclusão

Uma tarefa só pode ser declarada concluída com evidências aplicáveis:

- format;
- lint;
- typecheck;
- testes;
- build;
- codegen;
- validação de schema;
- revisão do diff;
- critérios de aceite;
- documentação;
- Graph IR;
- riscos e limitações.

## Formato de conclusão

```text
Tarefa:
Resultado:
Arquivos criados:
Arquivos alterados:
Comandos executados:
Validações:
Decisões:
Dependências e licenças:
Contexto utilizado:
Graph IR:
Riscos:
Rollback:
Próxima tarefa:
```

## Stop conditions

Pare e solicite decisão quando:

- um gate aberto alterar a estrutura;
- houver mudança de ABI major;
- protocolo persistido for quebrado;
- compartilhamento GPU entre runtimes for necessário;
- um novo workspace ou lockfile for necessário;
- credenciais, publicação ou produção forem necessárias;
- uma decisão `LOCKED` parecer inviável;
- o escopo crescer materialmente.
