# LeadBee

Multi-tenant SaaS lead-management platform. Three surfaces, one API:
`backend/` (Fastify + Mongoose), `dashboard/` (React — superadmin control
plane), `mobile/` (Expo — tenant users).

## Engineering standards — read before changing code

These are binding rules, cited by ID in review. **Read the ones that cover the
surface you are touching.**

| Document | Covers |
| --- | --- |
| [docs/standards/README.md](./docs/standards/README.md) | Index, rule IDs, severity, exception process |
| [docs/standards/ARCHITECTURE-RULES.md](./docs/standards/ARCHITECTURE-RULES.md) | `ARCH-*` — tenancy, auth realms, layering. Never break these |
| [docs/standards/ENGINEERING-STANDARDS.md](./docs/standards/ENGINEERING-STANDARDS.md) | `ENG-*` — typing, errors, logging, testing, review, Definition of Done |
| [docs/standards/CONFIGURATION-AND-PLANS.md](./docs/standards/CONFIGURATION-AND-PLANS.md) | `CFG-*` — static vs dynamic config, plan/entitlement model |
| [backend/RULES.md](./backend/RULES.md) | `BE-*` |
| [dashboard/RULES.md](./dashboard/RULES.md) | `DASH-*` |
| [mobile/RULES.md](./mobile/RULES.md) | `MOB-*` |

The four invariants that are never negotiable:

1. `organizationId` comes from the verified JWT — never from client input.
2. Tenant isolation lives in the data layer, and absent scope **throws**.
3. Tenant and platform are separate realms: different secrets *and* audiences.
4. Anything a non-engineer would change is **data**, not a TypeScript union.

Rules are labelled **Enforced** (code complies; regressions block) or
**Target** (the standard we are moving to; new code complies). Do not assume a
rule describes current behaviour — check the label.

<!-- code-review-graph MCP tools -->
## MCP Tools: code-review-graph

**This project has a knowledge graph. Start with the code-review-graph
MCP tools to narrow scope, then read the source.** The graph is cheaper than scanning files and
gives you structural context (callers, dependents, test coverage) that file search cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes_tool` or `query_graph_tool` instead of Grep
- **Understanding impact**: `get_impact_radius_tool` instead of manually tracing imports
- **Code review**: `detect_changes_tool` + `get_review_context_tool` instead of reading entire files
- **Finding relationships**: `query_graph_tool` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview_tool` + `list_communities_tool`

### Verify in the source

- Narrow scope with the graph, then read the source. Do not change code from graph output alone.
- For any non-trivial change, read the implementation and the relevant tests before concluding.
- Verify the exact source when touching behavior, database logic, migrations, retries, fallbacks,
  recovery, or compatibility code.
- When the graph and the source disagree, the source wins. The graph may be stale or may not
  model that relationship.
- An empty graph result can mean "not indexed" or "not statically visible", not "does not exist".

### Key Tools

| Tool | Use when |
| ------ | ---------- |
| `detect_changes_tool` | Reviewing code changes — gives risk-scored analysis |
| `get_review_context_tool` | Need source snippets for review — token-efficient |
| `get_impact_radius_tool` | Understanding blast radius of a change |
| `get_affected_flows_tool` | Finding which execution paths are impacted |
| `query_graph_tool` | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes_tool` | Finding functions/classes by name or keyword |
| `get_architecture_overview_tool` | Understanding high-level codebase structure |
| `refactor_tool` | Planning renames, finding dead code |

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes_tool` for code review.
3. Use `get_affected_flows_tool` to understand impact.
4. Use `query_graph_tool` pattern="tests_for" to check coverage.
<!-- /code-review-graph MCP tools -->
