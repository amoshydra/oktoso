# Decision record: stay single-owner

Status: accepted, 2026-11-16. Revisit only on the triggers below.

## Context

Oktoso authenticates one owner. The owner token mints stateless session tokens
(`<expiry>.<HMAC>`, no identity payload), and every piece of local state is keyed
by session reference or device, not by user: read markers, drafts, notification
subscriptions, automation approvals, and the audit log. Multi-user is listed as
Phase 9 G5 with the default answer "defer", and `roadmap.md` calls a team control
plane a different product.

## Decision

Do not add users, roles, or per-user scoping. One hub serves one person.

## Why

1. **No user.** The deployment is one operator with a phone and a workstation.
   A second identity has no one to represent.
2. **It is a product fork, not a feature.** Read markers, drafts, notification
   routing, provider credentials, and audit attribution all become user-scoped;
   the auth token needs an identity; every route needs an ownership check; the
   UI needs a switcher. That is weeks, not days, and it breaks a deliberate
   non-goal.
3. **The alternative is cheaper.** A second person who needs access can run
   their own hub against the same providers. Providers hold the conversations;
   the hub holds only local state, so two hubs do not conflict.

## What a shared token does today

Two people can use one token. Nothing attributes an action to one of them, and
rotating the token signs both out. That is acceptable for a household-scale
deployment and unacceptable for a team; do not pretend otherwise in the docs.

## Triggers to revisit

- A second person needs access **and** cannot run their own hub (shared
  providers, shared automation, or a single public origin).
- An audit requirement demands per-person attribution.
- A provider starts issuing per-user credentials the hub must broker.

## Cost if it happens

Identity in the token, per-user state partitions (drafts, markers,
subscriptions, approvals), per-user provider credentials or a shared pool with
its own policy, audit attribution, an admin surface, and a migration of existing
state to the owner's identity. Estimate six weeks with tests, and treat it as a
major version.

## Consequences

- The docs keep saying "single owner" and the security review lists it as a
  residual risk.
- Any future team feature starts with this record, not with a schema change.
