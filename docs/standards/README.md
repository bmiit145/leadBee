# LeadBee Engineering Standards

The rules that govern this codebase. They are written to be **cited in code
review**, not admired once and forgotten.

## The documents

| Document | Governs | Applies to |
| --- | --- | --- |
| [ARCHITECTURE-RULES.md](./ARCHITECTURE-RULES.md) | System invariants that must never be broken — tenancy, auth realms, layering | everyone |
| [ENGINEERING-STANDARDS.md](./ENGINEERING-STANDARDS.md) | How code is written, tested, reviewed and shipped | everyone |
| [CONFIGURATION-AND-PLANS.md](./CONFIGURATION-AND-PLANS.md) | What may be configured at runtime, and how plans/entitlements work | everyone |
| [../../backend/RULES.md](../../backend/RULES.md) | Fastify + Mongoose specifics | `backend/` |
| [../../dashboard/RULES.md](../../dashboard/RULES.md) | React control-plane specifics | `dashboard/` |
| [../../mobile/RULES.md](../../mobile/RULES.md) | Expo + React Native specifics | `mobile/` |

Background, not rules: [ARCHITECTURE.md](../ARCHITECTURE.md) and
[MULTI-TENANCY.md](../MULTI-TENANCY.md) explain *how the system works*. These
documents say *what you are required to do*.

## Rule IDs

Every rule has a stable ID so review comments can be precise — "this breaks
`ARCH-3`" beats "I don't like this".

| Prefix | Document |
| --- | --- |
| `ARCH-n` | Architecture rules |
| `ENG-n` | Engineering standards |
| `CFG-n` | Configuration and plans |
| `BE-n` / `DASH-n` / `MOB-n` | Per-surface rules |

IDs are never reused. A retired rule is struck through and kept, so old review
comments still resolve to something.

## Severity

Each rule carries one of three levels.

| Level | Meaning |
| --- | --- |
| **MUST** | Merge blocker. A violation is a defect regardless of whether it currently causes a bug. |
| **SHOULD** | Default. Deviate only with a written reason in the PR description. |
| **MAY** | Explicitly allowed; listed to end recurring debate. |

## Status labels

These documents describe the standard, which is not always what the code does
today. Rules are labelled honestly:

| Label | Meaning |
| --- | --- |
| **Enforced** | The codebase complies. Regressions are blockers. |
| **Target** | The standard we are moving to. New code must comply; existing violations are tracked, not grandfathered silently. |

A rule marked **Target** with no tracking issue is a bug in this document.

## Exceptions

An exception requires, in the PR description:

1. the rule ID,
2. why compliance is not possible *here*,
3. what bounds the blast radius,
4. what would have to change to remove the exception.

"It was faster" is not a reason. Exceptions to any **MUST** rule additionally
need an [ADR](./ARCHITECTURE-RULES.md#adr-process).

## Changing these documents

The rules are versioned with the code and change by pull request like anything
else. A rule that is routinely ignored is either wrong or unenforceable — fix
the rule or fix the enforcement, but do not leave it standing as decoration.
