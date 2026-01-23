# Wave Execution Guide

Detailed instructions for executing waves after planning is complete.

---

## Execution Commands

After planning, execute waves using claude-flow:

```bash
# Execute Wave 1
./claude-flow swarm "Execute Wave 1" \
  --config .claude/hive-mind/{project}-wave-1.yaml \
  --strategy development \
  --mode hierarchical

# After Wave 1 completes
./claude-flow swarm "Execute Wave 2" \
  --config .claude/hive-mind/{project}-wave-2.yaml
```

---

## Wave Completion Checklist (MANDATORY)

**Execute at the END of EACH wave, not at session end.**

This checklist is enforced by the governance skill. All items must be completed before moving to the next wave.

```bash
# 1. Run code review (AUTOMATIC - see below)
docker exec skillsmith-dev-1 npm run audit:standards

# 2. For EACH code review finding, do ONE of:
#    - Fix it immediately
#    - Create Linear sub-issue (REQUIRED if deferring)
npx tsx ~/.claude/skills/linear/scripts/linear-ops.ts create-sub-issue SMI-XXX "Issue title" "Description" --priority 3

# 3. Update Linear issue status
npx tsx ~/.claude/skills/linear/scripts/linear-ops.ts status Done SMI-XXX SMI-YYY

# 4. Commit with Co-Authored-By
git commit -m "feat(scope): description

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"

# 5. Create PR if wave is complete
gh pr create --title "Wave N: Description" --body "..."
```

---

## The Deferred Issue Rule

From the governance skill:

> "Deferred" is not a resolution. A Linear issue number is.

If you identify an issue that won't be fixed in the current wave:
1. Stop what you're doing
2. Create the Linear sub-issue immediately
3. Note the issue number in your review
4. Only then continue

**Anti-pattern (NEVER do this):**
> "This is a minor issue, we can address it later."

**Correct pattern:**
> "Created SMI-1234 to track this. Deferring to post-merge."

---

## Automated Code Review Trigger

Configure the coder agent to automatically invoke the reviewer agent after completion:

```yaml
# .claude/hive-mind/{project}-wave-{n}.yaml
agents:
  - type: coder
    role: lead
    issues: [SMI-XXX]
    on_complete:
      - trigger: reviewer
        scope: changed_files
        require_pass: true

  - type: reviewer
    role: support
    auto_triggered: true
    actions:
      - run: npm run audit:standards
      - for_each_finding:
          - severity: critical → fix_immediately
          - severity: major → fix_or_create_issue
          - severity: minor → fix_or_create_issue
```

Or invoke manually after each coder agent completes:

```bash
# Spawn reviewer agent after coder completes
Task({
  description: "Code review wave N changes",
  prompt: "Review all changes in this wave. For each finding: fix it OR create a Linear sub-issue. No exceptions.",
  subagent_type: "reviewer"
})
```

---

## Worktree Integration

Wave execution can leverage git worktrees for isolation. See the **worktree-manager** skill for detailed guidance.

### Strategy Selection

| Wave Pattern | Worktree Strategy | Rationale |
|--------------|-------------------|-----------|
| Sequential waves with dependencies | Single worktree | Changes build on each other |
| Independent parallel waves | Multiple worktrees | True isolation, parallel execution |
| Mixed (some deps, some independent) | Evaluate per-wave | Use dependency analysis |

### Quick Reference

```bash
# Single worktree for sequential execution
git worktree add ../worktrees/wave-execution -b feature/wave-execution

# Multiple worktrees for parallel waves (if truly independent)
git worktree add ../worktrees/wave-1 -b feature/wave-1
git worktree add ../worktrees/wave-2 -b feature/wave-2
```

### When to Use Multiple Worktrees

Use multiple worktrees only when:
1. Waves are **truly independent** (no shared file modifications)
2. You have **multiple Claude sessions** to run in parallel
3. The overhead of managing multiple worktrees is justified

For most wave executions, a **single worktree** is recommended.

---

## Post-Wave Verification

After completing a wave, verify:

```bash
# Check all tests pass
docker exec skillsmith-dev-1 npm test

# Check no lint errors
docker exec skillsmith-dev-1 npm run lint

# Verify Linear issues updated
npx tsx ~/.claude/skills/linear/scripts/linear-ops.ts list-issues "Project Name" --status Done

# Check PR created (if applicable)
gh pr list --state open
```

---

## Rollback Procedures

If a wave introduces breaking changes:

```bash
# 1. Revert the wave commit(s)
git revert HEAD~{n}..HEAD

# 2. Update Linear issues back to "In Progress"
npx tsx ~/.claude/skills/linear/scripts/linear-ops.ts status "In Progress" SMI-XXX SMI-YYY

# 3. Add comment explaining rollback
npx tsx ~/.claude/skills/linear/scripts/linear-ops.ts add-comment SMI-XXX "Rolled back due to: [reason]"

# 4. Re-plan with updated scope
/wave-planner "Project Name" --update
```
