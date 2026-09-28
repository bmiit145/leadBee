<!-- code-review-graph MCP tools -->
## Binding engineering standards

Before changing or reviewing code, read `docs/standards/README.md` and the
standards that apply to the affected surface (`ARCHITECTURE-RULES.md`,
`ENGINEERING-STANDARDS.md`, `CONFIGURATION-AND-PLANS.md`, and the relevant
surface `RULES.md`). These are binding requirements, not optional suggestions.
Follow every applicable **MUST** rule; where a rule is marked **Target**, new
and changed code must meet it. Do not claim existing behavior is compliant
without checking its implementation. If a requirement conflicts with the task,
identify the exact rule and explain the concrete conflict; do not silently
skip it. Any exception must follow the documented exception process.

## End-to-end feature completeness

- Trace the user's entry point through the action, navigation, service/API,
  authorization and final user-visible outcome before declaring a feature done.
- Every visible control that promises an action must perform that action, show
  appropriate loading/success/error states, or be explicitly and accessibly
  disabled with its reason. No placeholder no-ops, dead buttons, or stale
  comments claiming functionality is unbuilt when it already exists.
- Reuse established routes, services, shared clients, permissions and design
  patterns. Do not create a parallel path that bypasses them.
- Check relevant tests and add/update coverage required by `ENG-18` onward.
  Report verification accurately; never imply runtime behavior was tested when
  only source inspection was done.

These requirements apply to every agent and tool working in this repository,
including implementation, review, refactoring and documentation tasks.

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
