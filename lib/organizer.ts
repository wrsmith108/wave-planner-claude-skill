/**
 * Wave Organizer Module
 *
 * Organizes issues into waves based on shared context and dependencies.
 * Uses Jaccard similarity for context grouping.
 */

import { Issue } from '../adapters/interface';
import { CodebaseContext, TokenEstimate, TokenEstimator } from './estimator';

// ============================================================================
// Types
// ============================================================================

export interface Wave {
  number: number;
  name: string;
  description: string;
  issues: Issue[];
  tokenEstimate: TokenEstimate;
  agents: AgentAssignment[];
  dependencies: number[];     // Wave numbers this depends on
  parallelizable: boolean;    // Can issues run in parallel?
}

export interface AgentAssignment {
  issueId: string;
  issueIdentifier: string;
  agentType: AgentType;
  rationale: string;
}

export type AgentType =
  | 'security-specialist'
  | 'backend-developer'
  | 'frontend-developer'
  | 'test-engineer'
  | 'devops-engineer'
  | 'documentation-writer'
  | 'researcher'
  | 'general-purpose';

export interface WaveGroup {
  issues: Issue[];
  sharedFiles: Set<string>;
  similarity: number;
}

export interface OrganizerConfig {
  similarityThreshold: number;    // Min Jaccard similarity for grouping (default: 0.3)
  maxIssuesPerWave: number;       // Soft limit (default: 5)
  tokenBudgetPerWave: number;     // Split if exceeded (default: 150000)
  respectDependencies: boolean;   // Order by dependencies (default: true)
}

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULT_ORGANIZER_CONFIG: OrganizerConfig = {
  similarityThreshold: 0.3,
  maxIssuesPerWave: 5,
  tokenBudgetPerWave: 150000,
  respectDependencies: true,
};

// ============================================================================
// Wave Organizer
// ============================================================================

export class WaveOrganizer {
  private config: OrganizerConfig;
  private tokenEstimator: TokenEstimator;

  constructor(
    config: Partial<OrganizerConfig> = {},
    tokenEstimator?: TokenEstimator
  ) {
    this.config = { ...DEFAULT_ORGANIZER_CONFIG, ...config };
    this.tokenEstimator = tokenEstimator || new TokenEstimator();
  }

  /**
   * Organize issues into waves based on shared context
   */
  organize(
    issues: Issue[],
    contexts: Map<string, CodebaseContext>
  ): Wave[] {
    if (issues.length === 0) return [];

    // Step 1: Calculate file overlap matrix
    const overlapMatrix = this.calculateOverlapMatrix(issues, contexts);

    // Step 2: Group issues by shared context
    const groups = this.groupByContext(issues, overlapMatrix);

    // Step 3: Order groups by dependencies
    const orderedGroups = this.config.respectDependencies
      ? this.orderByDependencies(groups, issues)
      : groups;

    // Step 4: Split large groups and convert to waves
    const waves = this.groupsToWaves(orderedGroups, contexts);

    // Step 5: Assign agents to each wave
    return waves.map(wave => ({
      ...wave,
      agents: this.assignAgents(wave.issues),
    }));
  }

  // -------------------------------------------------------------------------
  // Step 1: Calculate Overlap Matrix
  // -------------------------------------------------------------------------

  private calculateOverlapMatrix(
    issues: Issue[],
    contexts: Map<string, CodebaseContext>
  ): Map<string, Map<string, number>> {
    const matrix = new Map<string, Map<string, number>>();

    for (const issueA of issues) {
      const rowMap = new Map<string, number>();
      const filesA = this.getFilesForIssue(issueA, contexts);

      for (const issueB of issues) {
        if (issueA.id === issueB.id) {
          rowMap.set(issueB.id, 1.0); // Perfect self-similarity
          continue;
        }

        const filesB = this.getFilesForIssue(issueB, contexts);
        const similarity = this.jaccardSimilarity(filesA, filesB);
        rowMap.set(issueB.id, similarity);
      }

      matrix.set(issueA.id, rowMap);
    }

    return matrix;
  }

  private getFilesForIssue(
    issue: Issue,
    contexts: Map<string, CodebaseContext>
  ): Set<string> {
    const ctx = contexts.get(issue.id);
    if (!ctx) return new Set();

    return new Set([
      ...ctx.filesLikelyTouched.map(f => f.path),
      ...ctx.relatedFiles.map(f => f.path),
    ]);
  }

  private jaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
    if (setA.size === 0 && setB.size === 0) return 0;

    const intersection = new Set([...setA].filter(x => setB.has(x)));
    const union = new Set([...setA, ...setB]);

    return intersection.size / union.size;
  }

  // -------------------------------------------------------------------------
  // Step 2: Group by Context
  // -------------------------------------------------------------------------

  private groupByContext(
    issues: Issue[],
    overlapMatrix: Map<string, Map<string, number>>
  ): WaveGroup[] {
    const groups: WaveGroup[] = [];
    const assigned = new Set<string>();

    // Sort issues by priority to seed groups with high-priority items
    const sortedIssues = [...issues].sort((a, b) => {
      const priorityOrder = { 'P0-Critical': 0, 'P1-High': 1, 'P2-Medium': 2, 'P3-Low': 3 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });

    for (const issue of sortedIssues) {
      if (assigned.has(issue.id)) continue;

      // Find all issues with similarity above threshold
      const similar = sortedIssues.filter(other => {
        if (assigned.has(other.id)) return false;
        if (other.id === issue.id) return true;

        const similarity = overlapMatrix.get(issue.id)?.get(other.id) || 0;
        return similarity >= this.config.similarityThreshold;
      });

      // Create group
      const sharedFiles = this.findSharedFiles(similar, overlapMatrix);
      const avgSimilarity = this.calculateAvgSimilarity(similar, overlapMatrix);

      groups.push({
        issues: similar,
        sharedFiles,
        similarity: avgSimilarity,
      });

      // Mark as assigned
      for (const s of similar) {
        assigned.add(s.id);
      }
    }

    return groups;
  }

  private findSharedFiles(
    issues: Issue[],
    overlapMatrix: Map<string, Map<string, number>>
  ): Set<string> {
    // This would ideally track actual shared files
    // For now, return empty set as placeholder
    return new Set();
  }

  private calculateAvgSimilarity(
    issues: Issue[],
    overlapMatrix: Map<string, Map<string, number>>
  ): number {
    if (issues.length < 2) return 1.0;

    let total = 0;
    let count = 0;

    for (let i = 0; i < issues.length; i++) {
      for (let j = i + 1; j < issues.length; j++) {
        const similarity = overlapMatrix.get(issues[i].id)?.get(issues[j].id) || 0;
        total += similarity;
        count++;
      }
    }

    return count > 0 ? total / count : 0;
  }

  // -------------------------------------------------------------------------
  // Step 3: Order by Dependencies
  // -------------------------------------------------------------------------

  private orderByDependencies(groups: WaveGroup[], issues: Issue[]): WaveGroup[] {
    // Build dependency map from parent-child relationships
    const dependencyMap = new Map<string, Set<string>>();

    for (const issue of issues) {
      if (issue.parent) {
        if (!dependencyMap.has(issue.id)) {
          dependencyMap.set(issue.id, new Set());
        }
        dependencyMap.get(issue.id)!.add(issue.parent.id);
      }
    }

    // Sort groups so that dependencies come first
    return [...groups].sort((a, b) => {
      // Check if any issue in A depends on any issue in B
      const aDependsOnB = a.issues.some(issueA =>
        b.issues.some(issueB =>
          dependencyMap.get(issueA.id)?.has(issueB.id)
        )
      );

      // Check if any issue in B depends on any issue in A
      const bDependsOnA = b.issues.some(issueB =>
        a.issues.some(issueA =>
          dependencyMap.get(issueB.id)?.has(issueA.id)
        )
      );

      if (aDependsOnB && !bDependsOnA) return 1;  // A comes after B
      if (bDependsOnA && !aDependsOnB) return -1; // B comes after A
      return 0; // No dependency relationship
    });
  }

  // -------------------------------------------------------------------------
  // Step 4: Convert Groups to Waves
  // -------------------------------------------------------------------------

  private groupsToWaves(
    groups: WaveGroup[],
    contexts: Map<string, CodebaseContext>
  ): Omit<Wave, 'agents'>[] {
    const waves: Omit<Wave, 'agents'>[] = [];
    let waveNumber = 1;

    for (const group of groups) {
      // Split group if it exceeds budget or issue count
      const subGroups = this.splitGroupIfNeeded(group, contexts);

      for (const subGroup of subGroups) {
        const tokenEstimate = this.tokenEstimator.estimateWave(
          subGroup.issues,
          contexts
        );

        waves.push({
          number: waveNumber,
          name: this.generateWaveName(subGroup.issues, waveNumber),
          description: this.generateWaveDescription(subGroup),
          issues: subGroup.issues,
          tokenEstimate,
          dependencies: this.findWaveDependencies(subGroup.issues, waves),
          parallelizable: this.isParallelizable(subGroup.issues),
        });

        waveNumber++;
      }
    }

    return waves;
  }

  private splitGroupIfNeeded(
    group: WaveGroup,
    contexts: Map<string, CodebaseContext>
  ): WaveGroup[] {
    // Check if split is needed
    if (group.issues.length <= this.config.maxIssuesPerWave) {
      const estimate = this.tokenEstimator.estimateWave(group.issues, contexts);
      if (estimate.total <= this.config.tokenBudgetPerWave) {
        return [group];
      }
    }

    // Split into smaller groups
    const subGroups: WaveGroup[] = [];
    let currentIssues: Issue[] = [];
    let currentTokens = 0;

    for (const issue of group.issues) {
      const ctx = contexts.get(issue.id) || {
        filesLikelyTouched: [],
        relatedFiles: [],
        totalLines: 50,
        avgComplexity: 'medium' as const,
      };

      const issueEstimate = this.tokenEstimator.estimate(issue, ctx);

      // Check if adding this issue would exceed budget
      if (
        currentIssues.length >= this.config.maxIssuesPerWave ||
        (currentTokens + issueEstimate.total > this.config.tokenBudgetPerWave && currentIssues.length > 0)
      ) {
        // Start new sub-group
        subGroups.push({
          issues: currentIssues,
          sharedFiles: new Set(),
          similarity: group.similarity,
        });
        currentIssues = [];
        currentTokens = 0;
      }

      currentIssues.push(issue);
      currentTokens += issueEstimate.total;
    }

    // Add remaining issues
    if (currentIssues.length > 0) {
      subGroups.push({
        issues: currentIssues,
        sharedFiles: new Set(),
        similarity: group.similarity,
      });
    }

    return subGroups;
  }

  private generateWaveName(issues: Issue[], waveNumber: number): string {
    // Try to derive name from common labels
    const labelCounts = new Map<string, number>();

    for (const issue of issues) {
      for (const label of issue.labels) {
        labelCounts.set(label.name, (labelCounts.get(label.name) || 0) + 1);
      }
    }

    // Find most common label
    let topLabel = '';
    let topCount = 0;

    for (const [label, count] of labelCounts) {
      if (count > topCount) {
        topLabel = label;
        topCount = count;
      }
    }

    if (topLabel && topCount >= issues.length / 2) {
      return this.capitalize(topLabel);
    }

    // Default names based on wave number
    const defaultNames = [
      'Foundation',
      'Core Features',
      'Integration',
      'Enhancement',
      'Polish',
      'Finalization',
    ];

    return defaultNames[waveNumber - 1] || `Wave ${waveNumber}`;
  }

  private generateWaveDescription(group: WaveGroup): string {
    const issueIds = group.issues.map(i => i.identifier).join(', ');
    const similarity = Math.round(group.similarity * 100);

    return `Issues: ${issueIds} (${similarity}% context overlap)`;
  }

  private findWaveDependencies(
    issues: Issue[],
    existingWaves: Omit<Wave, 'agents'>[]
  ): number[] {
    const dependencies = new Set<number>();

    for (const issue of issues) {
      if (issue.parent) {
        // Find which wave contains the parent
        for (const wave of existingWaves) {
          if (wave.issues.some(i => i.id === issue.parent?.id)) {
            dependencies.add(wave.number);
          }
        }
      }
    }

    return [...dependencies].sort((a, b) => a - b);
  }

  private isParallelizable(issues: Issue[]): boolean {
    // Check if any issues have parent-child relationships within the group
    const ids = new Set(issues.map(i => i.id));

    for (const issue of issues) {
      if (issue.parent && ids.has(issue.parent.id)) {
        return false; // Has internal dependencies
      }
    }

    return true;
  }

  // -------------------------------------------------------------------------
  // Step 5: Agent Assignment
  // -------------------------------------------------------------------------

  private assignAgents(issues: Issue[]): AgentAssignment[] {
    return issues.map(issue => {
      const agentType = this.inferAgentType(issue);
      return {
        issueId: issue.id,
        issueIdentifier: issue.identifier,
        agentType,
        rationale: this.generateAgentRationale(issue, agentType),
      };
    });
  }

  private inferAgentType(issue: Issue): AgentType {
    const text = `${issue.title} ${issue.description}`.toLowerCase();
    const labels = issue.labels.map(l => l.name.toLowerCase());

    // Security signals
    if (
      labels.some(l => ['security', 'auth', 'authentication', 'vulnerability'].includes(l)) ||
      /security|auth|encrypt|credential|permission|access control|xss|sql injection|csrf/i.test(text)
    ) {
      return 'security-specialist';
    }

    // Frontend signals
    if (
      labels.some(l => ['frontend', 'ui', 'ux', 'component', 'react', 'vue', 'css'].includes(l)) ||
      /component|ui|ux|react|vue|angular|css|style|layout|responsive|accessibility/i.test(text)
    ) {
      return 'frontend-developer';
    }

    // Backend signals
    if (
      labels.some(l => ['backend', 'api', 'database', 'server'].includes(l)) ||
      /api|endpoint|database|query|migration|server|graphql|rest/i.test(text)
    ) {
      return 'backend-developer';
    }

    // DevOps signals
    if (
      labels.some(l => ['devops', 'ci', 'cd', 'infrastructure', 'deployment'].includes(l)) ||
      /ci\/cd|pipeline|deploy|docker|kubernetes|terraform|aws|gcp|azure/i.test(text)
    ) {
      return 'devops-engineer';
    }

    // Test signals
    if (
      labels.some(l => ['testing', 'test', 'qa', 'e2e'].includes(l)) ||
      /test|coverage|e2e|integration test|unit test|assertion/i.test(text)
    ) {
      return 'test-engineer';
    }

    // Documentation signals
    if (
      labels.some(l => ['documentation', 'docs', 'readme'].includes(l)) ||
      /documentation|readme|guide|tutorial|api doc/i.test(text)
    ) {
      return 'documentation-writer';
    }

    // Research/spike signals
    if (
      labels.some(l => ['spike', 'research', 'investigation', 'exploration'].includes(l)) ||
      /research|investigate|explore|prototype|poc|proof of concept/i.test(text)
    ) {
      return 'researcher';
    }

    // Default
    return 'general-purpose';
  }

  private generateAgentRationale(issue: Issue, agentType: AgentType): string {
    const reasons: Record<AgentType, string> = {
      'security-specialist': 'Issue involves security-sensitive operations',
      'backend-developer': 'Issue focuses on API/database/server-side work',
      'frontend-developer': 'Issue involves UI components or user experience',
      'test-engineer': 'Issue is primarily about testing coverage',
      'devops-engineer': 'Issue involves CI/CD or infrastructure',
      'documentation-writer': 'Issue focuses on documentation updates',
      'researcher': 'Issue requires investigation or prototyping',
      'general-purpose': 'Issue spans multiple domains',
    };

    return reasons[agentType];
  }

  private capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}

// ============================================================================
// Exports
// ============================================================================

export const organizer = new WaveOrganizer();
export default WaveOrganizer;
