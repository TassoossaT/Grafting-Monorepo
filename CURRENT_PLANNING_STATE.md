# Estado atual do planejamento

> **Tipo:** estado operacional mutável
> **Autoridade:** não altera a arquitetura; em conflito,
> `GRAFTING_MASTER_SOURCE.md` vence.
> **Atualizado em:** 26 de julho de 2026

## Situação

- Repositório Git criado em 26 de julho de 2026; primeiro commit documental
  realizado.
- Existem `README.md`, `GRAFTING_MASTER_SOURCE.md` (v1.7.1),
  `CURRENT_PLANNING_STATE.md`, `AGENTS.md`, `CLAUDE.md`, `docs/adr/` (8
  ADRs) e um `.ai/` mínimo (`README.md` + skill `task-completion`, ativa —
  demais diretórios do layout canônico da seção 29.1 ainda não criados).
- Não existem workspaces, lockfiles, aplicações, crates, pipelines,
  toolchains instaladas (exceto git/node/dotnet no PC do proprietário) ou
  infraestrutura em execução. A fase é exclusivamente de arquitetura e
  preparação — nada disto deve ser tratado como implementado.
- A fonte arquitetural ativa é `GRAFTING_MASTER_SOURCE.md`; `docs/adr/` é o
  histórico de decisões que a alimenta.

## Fase atual

```text
planejamento
→ revisão adversarial          (não executada formalmente ainda)
→ fechamento dos Decision Gates   ← concluído hoje
→ ADRs                            ← concluído hoje
→ spikes descartáveis          ← próximo passo
→ scaffold
```

## Decision Gates — estado consolidado

| Gate | Estado | Decisão | Registro |
| --- | --- | --- | --- |
| GATE-001 | **fechado** | Host Web = Next.js; VTT é uma rota client-only, não o app inteiro | DEC-041 · ADR-0001 |
| GATE-002 | aberto, **adiado formalmente** | Engine C# espera um jogo concreto; trabalho genérico de `isekai-capi`/`Grafting.Isekai.Interop` liberado | ADR-0002 |
| GATE-003 | **fechado** | Cliente desktop V1 = Windows x64; Linux/macOS só build do core | DEC-043 · ADR-0003 |
| GATE-004 | aberto, **adiado formalmente** | Host do servidor autoritativo espera a Fase 6 / Epic H | ADR-0005 |
| GATE-005 | **fechado** | Determinismo de replay na mesma plataforma/build; GPU nunca escreve direto no state hash | DEC-044 · ADR-0004 |
| GATE-007 | **fechado** | Monorepo único; "vender" um produto = empacotar o artefato daquele app, não dividir repositório | DEC-045 · ADR-0007 |
| GATE-006, 008, 009 | abertos, sem prioridade | Fallback sem WebGPU; licença/proprietariedade; persistência do multiplayer | — |

Nenhum agente deve fechar GATE-002, GATE-004 ou qualquer gate de GATE-006 a
GATE-009 sem decisão explícita do proprietário.

## Decisões estruturais complementares (não são gates numerados)

| Decisão | Conteúdo | Registro |
| --- | --- | --- |
| Polymath | Um pacote por runtime (`polymath`/`@grafting/polymath`/`Grafting.Polymath`) é o único lugar que pode inspecionar SO/runtime/RID | DEC-042 · ADR-0006 |
| Fronteira `libs/` + mapa de domínios | Capacidade usada por >1 produto nasce em `libs/domains`/`packages/`, nunca duplicada num app. Mapa inicial: `narrative` e `session` genéricos; mapa X6 do VTT específico do produto (só `packages/x6-canvas` é compartilhado com o Architecture Studio); Discord e transcrição são integrações externas, não domínios | DEC-046 · ADR-0008 · fonte mestre §4.4 |

Pendente, mas não bloqueia a Fase 0: diretório-padrão de integrações
externas (`apps/integrations/` vs. `tools/`) quando Discord/transcrição
saírem do papel.

Índice completo de ADRs, com status e link: `docs/adr/README.md`.

## Spikes fundacionais previstos (Fase 0 — próximo passo)

1. Rust → Wasm em Dedicated Worker, sob o host Next.js (GATE-001);
2. Rust C ABI/DLL → C# genérico (`isekai-capi` + `Grafting.Isekai.Interop`),
   sem escolher engine — independente de GATE-002;
3. mesmo WGSL em wgpu nativo e Web, respeitando o piso de determinismo do
   GATE-005 (GPU nunca escreve direto no state hash);
4. Polymath v0 (`libs/platform/polymath`, `packages/polymath`) — suporte
   real só para Windows, stubs explícitos para as demais plataformas;
5. benchmark de batching e copy budget;
6. validação inicial de Nx e toolchains;
7. Graph IR mínimo e visualização X6 read-only;
8. AI Control Plane mínimo sem gateway ou autoevolução avançada.

Toolchain no PC do proprietário (verificado em 26/07/2026): git, node,
dotnet instalados; **faltam** rustc/cargo, pnpm, uv, wasm-pack, flatc
(este último só é necessário a partir da Fase 2).

## Próxima ação recomendada

Planejamento estrutural concluído — todos os gates prioritários e as
decisões de reaproveitamento multi-produto estão resolvidos ou formalmente
adiados. O próximo passo é instalar as toolchains faltantes e começar os
spikes 1–4 acima, nessa ordem ou em paralelo.

## Regra de atualização

Este arquivo registra apenas: estado real, fase corrente, próximos passos,
bloqueios e decisões aguardando o proprietário. Decisões arquiteturais
propriamente ditas vivem na fonte mestre ou em ADR — este arquivo aponta
para elas, não as repete.
