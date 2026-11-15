# Decision record: keep the hub in TypeScript

Status: accepted, 2026-11-16. Revisit at the Phase 8 exit review.

## Context

Phase 8 asks whether the hub should be ported to Rust. The hub is one Node
process: an HTTP API, an SSE event bus, a per-provider adapter layer, a
transcript cache, an inverted index, and a supervisor. It runs on a workstation
and on a phone under Termux.

Constraints that shape the answer:

- The product constraint is pure-JavaScript dependencies and no native modules,
  so the same tree runs on Termux (`AGENTS.md`).
- Providers are HTTP APIs; the hub is I/O-bound, not compute-bound.
- Measured costs today: search p95 2.5 ms over 500 sessions
  (`scripts/bench-search.ts`), SSE fan-out p95 0.099 ms per publish with 200
  subscribers (`scripts/load-test.ts`), memory in the tens of MB for state and
  ~12 MB for a 500-session index.
- The team is one person, and the hub is pre-1.0 with active schema changes.

## Decision

Stay on TypeScript. Do not start a port now.

## Why

1. **No measured pain.** The slowest user-visible path is a provider round trip,
   not hub code. A rewrite would not change the latency a user feels.
2. **Termux is a hard requirement.** A Rust binary would need per-architecture
   builds and a Termux toolchain story, and would lose `npx @amoshydra/oktoso`
   as the install path.
3. **The domain is changing.** Search, supervisor, and provider contracts moved
   in the last two phases. A port locks shapes that are still moving.
4. **Cost is asymmetric.** A port is months and a permanent second toolchain; the
   benefit would be throughput headroom the product does not need at one owner.

## Triggers that would reopen this

- Sustained event throughput above ~10k events per second, or SSE fan-out above
  ~1,000 concurrent clients, with CPU pinned.
- A CPU-bound feature the profile shows cannot be fixed in JS: for example
  semantic search over a large transcript corpus, or on-device inference.
- Memory pressure on Termux that the cache and index caps cannot bound.
- A second full-time maintainer with Rust experience and a stable contract.

If a trigger fires, the port is gated on the **contract tests**, not on a
rewrite plan: the OpenAPI contract, the adapter conformance suite, the
automation safety matrix, and the search acceptance gate must pass unchanged
before and after. Port one module at a time behind the same HTTP surface; do not
rewrite the hub in place.

## Alternatives considered

- **Rust core + Node shell.** Rejected: two toolchains, FFI boundary, and
  duplicate release artifacts for no measured gain.
- **Go.** Rejected: same install problem on Termux plus a smaller ecosystem for
  the current provider SDKs.
- **Bun.** Rejected: not the supported runtime for the Termux path and not part
  of the Node 24 target.

## Consequences

- Performance work stays in measurement, not language: keep the two scripts as
  the reference benchmarks.
- Any future port starts from the conformance suite, which does not exist yet
  (Phase 6 D3, deferred). That is the first thing to build if this decision is
  ever revisited.
