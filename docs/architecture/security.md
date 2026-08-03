# Security and robustness

> Extracted from `GRAFTING_MASTER_SOURCE.md` §21 as part of the master-source
> split (`DOCS-CONTEXT-SPLIT`). See `GRAFTING_MASTER_SOURCE.md` §0's router
> table for the full document map.

## Untrusted data

Every network payload must:

- have a size limit;
- be verified;
- validate version;
- validate command type;
- validate authorization on the host;
- validate semantics in the core;
- reject invalid offsets.

## FFI

Every export must:

- validate null;
- validate length;
- validate overflow;
- validate alignment when necessary;
- return a status;
- never unwind across the boundary.

## GPU

Limit:

- buffer size;
- number of jobs;
- workgroups;
- resident memory;
- maximum cooperative time;
- queue per origin;
- device loss retries.

## Supply chain

- committed lockfiles;
- pinned toolchains;
- checksums for downloaded binaries;
- reviewed new dependencies;
- Nx plugins treated as executable code;
- remote cache only in a trusted domain.
