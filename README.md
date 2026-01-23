# Wave Planner Skill for Claude Code

Transform project issues into execution-ready implementation plans with wave-based organization, specialist agent assignments, token estimates, and TDD workflow integration.

## Installation

```bash
git clone https://github.com/wrsmith108/wave-planner-claude-skill.git ~/.claude/skills/wave-planner
```

## Features

- **Discovery**: Fetches issues from PM tools (Linear, GitHub Issues)
- **Architecture Decisions**: Surfaces decisions requiring clarification
- **Risk Prediction**: Identifies blockers and generates mitigations
- **Wave Organization**: Groups issues by shared context
- **Token Estimation**: Dynamic codebase analysis for accurate estimates
- **Agent Assignment**: Assigns specialist agents via LLM inference
- **Artifact Generation**: Creates implementation plans, hive configs, ADRs

## Quick Start

```
# Explicit invocation
/wave-planner "Project Name"

# Natural language
"Plan the implementation for the authentication system"
"Break down the API redesign into waves"
```

## Behavioral Classification

**Type**: Guided Decision
**Directive**: ASK, THEN EXECUTE

The skill asks structured questions upfront, then executes based on your choices.

## Requirements

- Claude Code CLI
- Linear skill (for Linear integration) or GitHub CLI
- claude-flow MCP server (for execution)

## Configuration

Create `~/.claude/skills/wave-planner/config.yaml`:

```yaml
wave-planner:
  defaults:
    max_waves: 6
    max_issues_per_wave: 5
    token_budget_per_wave: 150000
  adapters:
    preferred: auto  # or: linear, github
```

## Environment Variables

```bash
# For Linear integration
LINEAR_API_KEY=lin_api_xxx

# For GitHub integration
GITHUB_TOKEN=ghp_xxx
```

## Documentation

- [SKILL.md](SKILL.md) - Core skill documentation
- [preflight.md](preflight.md) - Pre-flight check script
- [execution.md](execution.md) - Wave execution guide
- [reference.md](reference.md) - Detailed reference documentation

## License

MIT
