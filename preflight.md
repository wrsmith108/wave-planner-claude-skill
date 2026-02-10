# Pre-Flight Checks

Before starting any wave execution, verify the environment is ready. Skipping this causes mid-execution failures.

## Automated Check Script

```bash
#!/bin/bash
# scripts/wave-preflight.sh

echo "=== Wave Execution Pre-Flight Check ==="

# 1. MCP Server Configuration
echo "Checking MCP configuration..."
if [ -f ".mcp.json" ]; then
  if grep -q "claude-flow" .mcp.json; then
    echo "✅ claude-flow MCP configured"
  else
    echo "❌ claude-flow not in .mcp.json"
    echo "   Run: claude mcp add claude-flow -- npx claude-flow@alpha mcp start"
    exit 1
  fi
else
  echo "❌ No .mcp.json found"
  exit 1
fi

# 2. Docker Container
echo "Checking Docker..."
CONTAINER_NAME="${CONTAINER_NAME:-<your-container-name>}"
if docker ps --filter "name=$CONTAINER_NAME" --format "{{.Status}}" | grep -q "Up"; then
  echo "✅ Docker container running"
else
  echo "⚠️  Docker container not running"
  echo "   Run: docker compose --profile dev up -d"
  docker compose --profile dev up -d
  sleep 3
fi

# 3. Git-Crypt (if repo uses it)
echo "Checking git-crypt..."
if [ -f ".git-crypt/keys/default/0/*.gpg" ] 2>/dev/null || git-crypt status &>/dev/null; then
  echo "✅ git-crypt available"
else
  echo "⚠️  git-crypt not configured (may be optional)"
fi

# 4. Linear API
echo "Checking Linear access..."
if npx tsx scripts/linear-ops.ts whoami &>/dev/null; then
  echo "✅ Linear API accessible"
else
  echo "❌ Linear API not accessible"
  echo "   Check LINEAR_API_KEY environment variable"
  exit 1
fi

echo ""
echo "=== Pre-flight complete. Ready for wave execution. ==="
```

## Quick Manual Check

If not using the script, verify manually:

| Check | Command | Expected |
|-------|---------|----------|
| MCP Server | `grep claude-flow .mcp.json` | Found |
| Docker | `docker ps \| grep <project-name>` | Running |
| Git-crypt | `git-crypt status` | Unlocked |
| Linear | `linear issues list --limit 1` | Returns issues |

## Customizing the Script

Copy the script to your project and modify:

```bash
# Copy to project
cp ~/.claude/skills/wave-planner/scripts/wave-preflight.sh ./scripts/

# Modify container name, checks, etc.
vim scripts/wave-preflight.sh

# Run before wave execution
./scripts/wave-preflight.sh
```

## Common Pre-Flight Failures

| Failure | Cause | Fix |
|---------|-------|-----|
| "claude-flow not in .mcp.json" | MCP server not configured | `claude mcp add claude-flow -- npx claude-flow@alpha mcp start` |
| "Docker container not running" | Container stopped | `docker compose --profile dev up -d` |
| "Linear API not accessible" | Missing or invalid key | Check `LINEAR_API_KEY` env var |
| "git-crypt not configured" | Encrypted files | `varlock run -- sh -c 'git-crypt unlock "$GIT_CRYPT_KEY_PATH"'` |
