# Observability

> Extracted from `GRAFTING_MASTER_SOURCE.md` §20 as part of the master-source
> split (`DOCS-CONTEXT-SPLIT`). See `GRAFTING_MASTER_SOURCE.md` §0's router
> table for the full document map.

The core must produce structured diagnostic events, not write directly to the UI.

Fields:

- severity;
- subsystem;
- code;
- message ID;
- job ID;
- tick;
- duration;
- bytes uploaded;
- bytes read back;
- backend;
- adapter;
- build ID.

Hosts decide:

- console;
- file;
- telemetry;
- overlay;
- distributed tracing.

Sensitive or secret data must not appear in logs.
