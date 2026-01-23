# Wave Planner Reference

Detailed documentation for output artifacts, token estimation, agent assignment, and TDD workflow.

---

## Output Artifacts

### Implementation Plan

Full markdown document with:
- Architecture decisions table
- **Risk register with mitigations**
- Wave structure with token estimates
- TDD test cases per issue
- Acceptance criteria
- Execution commands

### Hive Mind Configs

Ready-to-execute YAML for claude-flow:

```yaml
name: "Phase 3 Wave 1: Foundation"
resources:
  max_agents: 3
  profile: laptop

agents:
  - type: backend-developer
    role: lead
    issues: [SMI-1630, SMI-1629]

quality:
  require_tests: true
  tdd_workflow: red-green-refactor
  governance_review: after_each_commit
```

### ADRs

Created for significant architecture decisions:

```markdown
# ADR-024: Security Scan Storage

## Status
Accepted

## Decision
Use dedicated security schema for scan results.

## Consequences
- Isolation from main skill data
- Can have different retention policies
- Requires separate migrations
```

---

## Token Estimation

Estimates are calculated dynamically:

| Component | Calculation |
|-----------|-------------|
| Context | Files to read × 1.5 (related files) |
| Implementation | Lines touched × complexity × priority |
| Tests | Implementation × 0.6 (TDD overhead) |
| Review | (Impl + Tests) × 0.3 × 2 cycles |
| Documentation | Implementation × 0.1 |

**Confidence Levels:**
- **High**: Clear scope, known files
- **Medium**: Some unknowns, estimated files
- **Low**: Spike/research, many unknowns

### Token Budget Guidelines

| Profile | Budget/Wave | Max Agents |
|---------|-------------|------------|
| laptop | 150K tokens | 2 |
| workstation | 300K tokens | 4 |
| server | 500K tokens | 8 |

---

## Agent Assignment

Agents are assigned via LLM inference based on issue content:

| Agent Type | Triggers |
|------------|----------|
| `security-specialist` | Auth, encryption, vulnerabilities |
| `backend-developer` | API, database, services |
| `frontend-developer` | UI, components, styling |
| `test-engineer` | Coverage, E2E, integration |
| `devops-engineer` | CI/CD, deployment, infra |
| `documentation-writer` | Docs, README, API docs |
| `researcher` | Spikes, analysis, investigation |

### Agent Selection Logic

```
1. Parse issue title and description
2. Identify keywords matching agent triggers
3. Score each agent type by keyword matches
4. Select highest-scoring agent
5. If tie, prefer specialist over generalist
```

---

## TDD Workflow

Each issue follows red-green-refactor:

### Red Phase
Write failing tests covering:
- Acceptance criteria
- Edge cases
- Expected behavior

### Green Phase
Minimal implementation to pass tests.
No optimization yet.

### Refactor Phase
Clean up while tests stay green:
- Code clarity
- Performance
- Consistency

### Governance Hook
After each commit:
```bash
npm run audit:standards
```
Findings become sub-issues in PM tool.

---

## PM Tool Adapters

### Supported Tools

| Tool | Status | Notes |
|------|--------|-------|
| Linear | Primary | Full support via Linear skill |
| GitHub Issues | Planned | v1.2 |
| Jira | Future | v2.0 |

### Auto-Detection

The skill detects your PM tool from:
1. CLAUDE.md configuration
2. Available skills (linear, github)
3. User prompt if ambiguous

---

## Example Session

```
User: Plan the implementation for Phase 3 Live Data

Claude: I'll help plan Phase 3 Live Data.

[Fetches project from Linear]

Found 12 issues. Which scope?
A) P0 only (2)
B) P0 + P1 (6)
C) All (12)

User: B

Claude: Planning 6 issues.

[Analyzes for architecture decisions]

SMI-825 needs a decision:
**Security scan storage location?**

A) Separate table
B) JSON column
C) Dedicated schema (Recommended)

Create an ADR?

User: C, yes create ADR

Claude: Creating ADR-024.

[Continues through decisions...]

Analyzing for risks...

Found 2 risks:
1. External Dependency (SMI-825): npm audit API
   → Mitigation: Add fallback to local vulnerability DB
2. Breaking Change (SMI-1632): Schema changes
   → Mitigation: Version schema, add migration

[Organizes into waves...]
[Assigns agents...]

Created:
- docs/execution/phase-3-implementation-plan.md
- docs/adr/024-security-scan-storage.md
- .claude/hive-mind/phase-3-wave-1.yaml
- .claude/hive-mind/phase-3-wave-2.yaml

Linked to Linear project.

Execute with:
./claude-flow swarm --config .claude/hive-mind/phase-3-wave-1.yaml
```

---

## Risk Categories

| Category | Description | Example |
|----------|-------------|---------|
| External Dependency | Third-party APIs, services, packages | npm audit API unavailable |
| Breaking Change | Schema, API, or contract changes | Database migration required |
| Integration | Cross-issue or cross-wave dependencies | Feature A depends on Feature B |
| Performance | Scalability, latency, resource constraints | Query timeout on large dataset |
| Security | Vulnerabilities, data exposure, auth issues | XSS vulnerability in input |
