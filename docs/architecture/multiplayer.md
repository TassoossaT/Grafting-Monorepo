# Multiplayer

Relocated verbatim from `GRAFTING_MASTER_SOURCE.md` section 15 on 2026-08-07, as the
router table in that document's S0.4 had scheduled. The section numbering is
preserved because `S<n>.<n>` is the stable citation key used from real source
comments and manifests; those citations resolve here now, unchanged.
Precedence and normative language remain in `GRAFTING_MASTER_SOURCE.md`
section 0 and govern everything below.

---

## 15. Multiplayer

### 15.1 Correct architecture name

V1:

> Authoritative replication with a journal of accepted commands and periodic snapshots.

Do not call it Event Sourcing.

### 15.2 Distinct types

| Type                 | Meaning                                           |
| -------------------- | ----------------------------------------------------- |
| `ClientCommand`    | intent sent by the client                       |
| `AcceptedCommand`  | authenticated, ordered, and accepted command                |
| `DomainEvent`      | semantic fact produced by the domain               |
| `ReplicationDelta` | projection transmissible to a specific client |
| `Snapshot`         | persistable authoritative state                      |

`DomainEvent` is not `ReplicationDelta`.

### 15.3 Flow

```text
ClientCommand
  → authentication/authorization on the host
  → ordering and deduplication
  → batch to Rust
  → DomainEvents + state hash
  → journal
  → per-client projection
  → ReplicationDelta
  → transport
```

### 15.4 Agnostic core

The core does not know about:

- sockets;
- IP;
- reconnection;
- TLS;
- database;
- queues;
- concrete authentication.

The host injects commands and collects results.

### 15.5 Journal

Minimum record:

- tick;
- sequence;
- command ID;
- logical client ID;
- AcceptedCommand;
- DomainEvents;
- state hash;
- core version;
- protocol version.

### 15.6 Snapshot

Minimum content:

- authoritative state;
- RNG state;
- last sequence;
- state hash;
- core version;
- protocol/save version.

### 15.7 Recovery

```text
load the most recent snapshot
→ apply subsequent AcceptedCommands
→ recompute state hash
→ compare
→ release the session
```

Full Event Sourcing will only be adopted if events become the primary source and there is a formal upcasting/migration policy.
