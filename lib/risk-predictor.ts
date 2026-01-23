/**
 * Risk Predictor Module
 *
 * Analyzes issues for potential blockers, fail cases, and dependencies
 * that might break. Generates mitigations for identified risks.
 *
 * @module wave-planner/lib/risk-predictor
 * @version 1.1.0
 */

import type { Issue, CodebaseContext } from '../adapters/interface';

// =============================================================================
// Types
// =============================================================================

export type RiskCategory =
  | 'external_dependency'
  | 'breaking_change'
  | 'integration'
  | 'performance'
  | 'security'
  | 'data_integrity'
  | 'resource_constraint'
  | 'timeline';

export type RiskLikelihood = 'low' | 'medium' | 'high';
export type RiskImpact = 'low' | 'medium' | 'high' | 'critical';

export interface Risk {
  id: string;
  category: RiskCategory;
  issueId: string;
  issueIdentifier: string;
  description: string;
  likelihood: RiskLikelihood;
  impact: RiskImpact;
  mitigation: string;
  affectedIssues?: string[];
  suggestedWaveAdjustment?: string;
}

export interface RiskAnalysisResult {
  risks: Risk[];
  totalRiskScore: number;
  highRisks: Risk[];
  waveAdjustments: WaveAdjustment[];
  summary: string;
}

export interface WaveAdjustment {
  type: 'reorder' | 'split' | 'add_dependency' | 'add_buffer';
  reason: string;
  affectedIssues: string[];
  recommendation: string;
}

// =============================================================================
// Risk Detection Patterns
// =============================================================================

interface RiskPattern {
  category: RiskCategory;
  keywords: string[];
  filePatterns: RegExp[];
  descriptionPatterns: RegExp[];
  defaultLikelihood: RiskLikelihood;
  defaultImpact: RiskImpact;
  mitigationTemplate: string;
}

const RISK_PATTERNS: RiskPattern[] = [
  {
    category: 'external_dependency',
    keywords: ['api', 'external', 'third-party', 'integration', 'webhook', 'oauth', 'sdk'],
    filePatterns: [/api\//, /integrations\//, /external\//, /clients\//],
    descriptionPatterns: [
      /calls?\s+(external|third-party|remote)/i,
      /integrat(e|ion)\s+with/i,
      /api\s+(call|request|endpoint)/i,
      /oauth|webhook|stripe|github|linear/i,
    ],
    defaultLikelihood: 'medium',
    defaultImpact: 'high',
    mitigationTemplate: 'Add fallback mechanism, implement retry logic with exponential backoff, cache responses where possible',
  },
  {
    category: 'breaking_change',
    keywords: ['schema', 'migration', 'refactor', 'rename', 'restructure', 'breaking'],
    filePatterns: [/schema/, /migrations\//, /db\//, /models\//],
    descriptionPatterns: [
      /chang(e|ing)\s+(schema|database|table)/i,
      /migrat(e|ion)/i,
      /breaking\s+change/i,
      /refactor/i,
      /renam(e|ing)/i,
    ],
    defaultLikelihood: 'high',
    defaultImpact: 'medium',
    mitigationTemplate: 'Version the schema, create migration script, add backwards compatibility layer, test rollback procedure',
  },
  {
    category: 'integration',
    keywords: ['depends', 'dependency', 'requires', 'blocks', 'after', 'before'],
    filePatterns: [],
    descriptionPatterns: [
      /depends\s+on/i,
      /requires?\s+(completion|implementation)/i,
      /after\s+(.*)\s+is\s+(done|complete)/i,
      /blocks?\s+by/i,
      /prerequisite/i,
    ],
    defaultLikelihood: 'medium',
    defaultImpact: 'high',
    mitigationTemplate: 'Define interface contract first, create mock implementations for parallel development, establish clear handoff criteria',
  },
  {
    category: 'performance',
    keywords: ['performance', 'scale', 'optimize', 'cache', 'load', 'concurrent'],
    filePatterns: [/cache\//, /performance\//, /workers\//],
    descriptionPatterns: [
      /performance/i,
      /scal(e|ability|ing)/i,
      /optimi(ze|zation)/i,
      /slow|fast|speed/i,
      /concurrent|parallel/i,
      /large\s+(data|dataset|volume)/i,
    ],
    defaultLikelihood: 'medium',
    defaultImpact: 'medium',
    mitigationTemplate: 'Add performance benchmarks, implement caching strategy, set up monitoring alerts, define acceptable thresholds',
  },
  {
    category: 'security',
    keywords: ['security', 'auth', 'permission', 'encrypt', 'vulnerability', 'credential'],
    filePatterns: [/auth\//, /security\//, /permissions\//],
    descriptionPatterns: [
      /security/i,
      /auth(entication|orization)?/i,
      /permission|access\s+control/i,
      /encrypt|decrypt/i,
      /vulnerabilit(y|ies)/i,
      /credential|secret|key/i,
    ],
    defaultLikelihood: 'medium',
    defaultImpact: 'critical',
    mitigationTemplate: 'Conduct security review, add threat model, implement defense in depth, ensure secrets management compliance',
  },
  {
    category: 'data_integrity',
    keywords: ['data', 'consistency', 'transaction', 'atomic', 'rollback'],
    filePatterns: [/db\//, /repositories\//, /transactions\//],
    descriptionPatterns: [
      /data\s+(integrity|consistency)/i,
      /transaction/i,
      /atomic/i,
      /rollback/i,
      /race\s+condition/i,
    ],
    defaultLikelihood: 'low',
    defaultImpact: 'high',
    mitigationTemplate: 'Use database transactions, implement idempotency, add data validation layer, create rollback procedures',
  },
  {
    category: 'resource_constraint',
    keywords: ['memory', 'cpu', 'disk', 'quota', 'limit', 'timeout'],
    filePatterns: [],
    descriptionPatterns: [
      /memory|cpu|disk/i,
      /quota|limit/i,
      /timeout/i,
      /resource\s+(constraint|limit)/i,
      /out\s+of\s+(memory|space)/i,
    ],
    defaultLikelihood: 'low',
    defaultImpact: 'medium',
    mitigationTemplate: 'Add resource monitoring, implement graceful degradation, set up alerts, define resource budgets',
  },
  {
    category: 'timeline',
    keywords: ['deadline', 'urgent', 'critical', 'blocker', 'priority'],
    filePatterns: [],
    descriptionPatterns: [
      /deadline/i,
      /urgent|critical|blocker/i,
      /time\s+(sensitive|critical)/i,
      /must\s+be\s+(done|complete)/i,
    ],
    defaultLikelihood: 'medium',
    defaultImpact: 'medium',
    mitigationTemplate: 'Break into smaller deliverables, identify MVP scope, establish checkpoints, prepare contingency plan',
  },
];

// =============================================================================
// Risk Predictor Class
// =============================================================================

export class RiskPredictor {
  private patterns: RiskPattern[];

  constructor(customPatterns?: RiskPattern[]) {
    this.patterns = customPatterns || RISK_PATTERNS;
  }

  /**
   * Analyze issues for potential risks and blockers
   */
  analyze(
    issues: Issue[],
    contexts: Map<string, CodebaseContext>
  ): RiskAnalysisResult {
    const risks: Risk[] = [];
    let riskIdCounter = 1;

    // Analyze each issue for risks
    for (const issue of issues) {
      const context = contexts.get(issue.id);
      const issueRisks = this.analyzeIssue(issue, context, riskIdCounter);
      risks.push(...issueRisks);
      riskIdCounter += issueRisks.length;
    }

    // Analyze cross-issue dependencies
    const integrationRisks = this.analyzeIntegrationRisks(issues, riskIdCounter);
    risks.push(...integrationRisks);

    // Calculate risk score and filter high risks
    const totalRiskScore = this.calculateRiskScore(risks);
    const highRisks = risks.filter(
      (r) => r.impact === 'critical' || r.impact === 'high'
    );

    // Generate wave adjustments based on risks
    const waveAdjustments = this.generateWaveAdjustments(risks, issues);

    // Generate summary
    const summary = this.generateSummary(risks, highRisks, waveAdjustments);

    return {
      risks,
      totalRiskScore,
      highRisks,
      waveAdjustments,
      summary,
    };
  }

  /**
   * Analyze a single issue for risks
   */
  private analyzeIssue(
    issue: Issue,
    context: CodebaseContext | undefined,
    startId: number
  ): Risk[] {
    const risks: Risk[] = [];
    const content = `${issue.title} ${issue.description || ''} ${issue.labels?.join(' ') || ''}`.toLowerCase();
    const files = context?.filePaths || [];

    for (const pattern of this.patterns) {
      // Check keywords
      const hasKeyword = pattern.keywords.some((kw) => content.includes(kw));

      // Check file patterns
      const hasFileMatch = pattern.filePatterns.some((fp) =>
        files.some((f) => fp.test(f))
      );

      // Check description patterns
      const hasDescriptionMatch = pattern.descriptionPatterns.some((dp) =>
        dp.test(content)
      );

      if (hasKeyword || hasFileMatch || hasDescriptionMatch) {
        // Adjust likelihood based on evidence strength
        let likelihood = pattern.defaultLikelihood;
        const evidenceCount =
          (hasKeyword ? 1 : 0) + (hasFileMatch ? 1 : 0) + (hasDescriptionMatch ? 1 : 0);
        if (evidenceCount >= 3) likelihood = 'high';
        else if (evidenceCount === 1 && likelihood === 'high') likelihood = 'medium';

        // Adjust impact based on priority
        let impact = pattern.defaultImpact;
        if (issue.priority === 'urgent' || issue.priority === 'critical') {
          if (impact === 'medium') impact = 'high';
          else if (impact === 'high') impact = 'critical';
        }

        // Generate context-specific mitigation
        const mitigation = this.generateMitigation(pattern, issue, context);

        risks.push({
          id: `RISK-${startId + risks.length}`,
          category: pattern.category,
          issueId: issue.id,
          issueIdentifier: issue.identifier,
          description: this.generateRiskDescription(pattern, issue, context),
          likelihood,
          impact,
          mitigation,
        });
      }
    }

    return risks;
  }

  /**
   * Analyze cross-issue integration risks
   */
  private analyzeIntegrationRisks(issues: Issue[], startId: number): Risk[] {
    const risks: Risk[] = [];

    // Check for parent-child dependencies
    for (const issue of issues) {
      if (issue.parentId) {
        const parent = issues.find((i) => i.id === issue.parentId);
        if (parent) {
          risks.push({
            id: `RISK-${startId + risks.length}`,
            category: 'integration',
            issueId: issue.id,
            issueIdentifier: issue.identifier,
            description: `${issue.identifier} depends on parent ${parent.identifier}`,
            likelihood: 'high',
            impact: 'high',
            mitigation: `Ensure ${parent.identifier} is completed first or define clear interface contract`,
            affectedIssues: [issue.identifier, parent.identifier],
            suggestedWaveAdjustment: `Place ${parent.identifier} in earlier wave than ${issue.identifier}`,
          });
        }
      }
    }

    // Check for label-based dependencies (e.g., "depends:SMI-123")
    for (const issue of issues) {
      const dependsLabels = issue.labels?.filter((l) =>
        l.toLowerCase().startsWith('depends:')
      ) || [];

      for (const label of dependsLabels) {
        const dependsOn = label.replace(/^depends:/i, '');
        const dependency = issues.find(
          (i) => i.identifier.toLowerCase() === dependsOn.toLowerCase()
        );

        if (dependency) {
          risks.push({
            id: `RISK-${startId + risks.length}`,
            category: 'integration',
            issueId: issue.id,
            issueIdentifier: issue.identifier,
            description: `${issue.identifier} explicitly depends on ${dependency.identifier}`,
            likelihood: 'high',
            impact: 'high',
            mitigation: `Verify ${dependency.identifier} interface is stable before starting ${issue.identifier}`,
            affectedIssues: [issue.identifier, dependency.identifier],
            suggestedWaveAdjustment: `Place ${dependency.identifier} in earlier wave`,
          });
        }
      }
    }

    return risks;
  }

  /**
   * Generate context-specific risk description
   */
  private generateRiskDescription(
    pattern: RiskPattern,
    issue: Issue,
    context: CodebaseContext | undefined
  ): string {
    const categoryDescriptions: Record<RiskCategory, string> = {
      external_dependency: 'relies on external service/API',
      breaking_change: 'may introduce breaking changes',
      integration: 'has dependencies on other issues',
      performance: 'may impact system performance',
      security: 'has security implications',
      data_integrity: 'may affect data consistency',
      resource_constraint: 'may hit resource limits',
      timeline: 'has timeline constraints',
    };

    const baseDescription = categoryDescriptions[pattern.category];
    const files = context?.filePaths?.slice(0, 3).join(', ') || 'multiple files';

    return `${issue.identifier} ${baseDescription} (affects: ${files})`;
  }

  /**
   * Generate context-specific mitigation
   */
  private generateMitigation(
    pattern: RiskPattern,
    issue: Issue,
    context: CodebaseContext | undefined
  ): string {
    let mitigation = pattern.mitigationTemplate;

    // Add context-specific suggestions
    if (context?.filePaths?.length) {
      const testFiles = context.filePaths.filter((f) =>
        /\.(test|spec)\.(ts|js)$/.test(f)
      );
      if (testFiles.length === 0) {
        mitigation += '. Add test coverage for affected files';
      }
    }

    // Add priority-specific suggestions
    if (issue.priority === 'urgent' || issue.priority === 'critical') {
      mitigation += '. Consider spike/POC first given high priority';
    }

    return mitigation;
  }

  /**
   * Calculate overall risk score (0-100)
   */
  private calculateRiskScore(risks: Risk[]): number {
    if (risks.length === 0) return 0;

    const impactWeights: Record<RiskImpact, number> = {
      low: 1,
      medium: 2,
      high: 4,
      critical: 8,
    };

    const likelihoodWeights: Record<RiskLikelihood, number> = {
      low: 1,
      medium: 2,
      high: 3,
    };

    let totalScore = 0;
    for (const risk of risks) {
      totalScore +=
        impactWeights[risk.impact] * likelihoodWeights[risk.likelihood];
    }

    // Normalize to 0-100 scale (assuming max 10 critical/high risks)
    const maxScore = 10 * 8 * 3; // 10 critical risks with high likelihood
    return Math.min(100, Math.round((totalScore / maxScore) * 100));
  }

  /**
   * Generate wave adjustment recommendations
   */
  private generateWaveAdjustments(
    risks: Risk[],
    issues: Issue[]
  ): WaveAdjustment[] {
    const adjustments: WaveAdjustment[] = [];

    // Group risks by affected issues
    const risksByIssue = new Map<string, Risk[]>();
    for (const risk of risks) {
      const existing = risksByIssue.get(risk.issueIdentifier) || [];
      existing.push(risk);
      risksByIssue.set(risk.issueIdentifier, existing);
    }

    // Check for high-risk issues that should be earlier
    for (const [issueId, issueRisks] of risksByIssue) {
      const hasBreakingChange = issueRisks.some(
        (r) => r.category === 'breaking_change'
      );
      const hasIntegrationRisk = issueRisks.some(
        (r) => r.category === 'integration'
      );

      if (hasBreakingChange) {
        adjustments.push({
          type: 'reorder',
          reason: `${issueId} has breaking change risk`,
          affectedIssues: [issueId],
          recommendation: `Place ${issueId} earlier in wave sequence to allow dependent issues to adapt`,
        });
      }

      if (hasIntegrationRisk) {
        const dependencies = issueRisks
          .filter((r) => r.category === 'integration')
          .flatMap((r) => r.affectedIssues || []);

        if (dependencies.length > 0) {
          adjustments.push({
            type: 'add_dependency',
            reason: `${issueId} has integration dependencies`,
            affectedIssues: [issueId, ...dependencies],
            recommendation: `Ensure ${dependencies.join(', ')} complete before ${issueId}`,
          });
        }
      }
    }

    // Add buffer recommendation if total risk score is high
    const totalScore = this.calculateRiskScore(risks);
    if (totalScore > 50) {
      adjustments.push({
        type: 'add_buffer',
        reason: 'High overall risk score',
        affectedIssues: [],
        recommendation:
          'Add 20% buffer to token estimates for risk mitigation overhead',
      });
    }

    return adjustments;
  }

  /**
   * Generate human-readable summary
   */
  private generateSummary(
    risks: Risk[],
    highRisks: Risk[],
    adjustments: WaveAdjustment[]
  ): string {
    if (risks.length === 0) {
      return 'No significant risks identified.';
    }

    const parts: string[] = [];

    parts.push(`Identified ${risks.length} risk(s).`);

    if (highRisks.length > 0) {
      parts.push(`${highRisks.length} high-impact risk(s) require attention.`);
    }

    if (adjustments.length > 0) {
      parts.push(`${adjustments.length} wave adjustment(s) recommended.`);
    }

    // Category breakdown
    const byCategory = new Map<RiskCategory, number>();
    for (const risk of risks) {
      byCategory.set(risk.category, (byCategory.get(risk.category) || 0) + 1);
    }

    const categoryList = Array.from(byCategory.entries())
      .map(([cat, count]) => `${count} ${cat.replace(/_/g, ' ')}`)
      .join(', ');

    parts.push(`Categories: ${categoryList}.`);

    return parts.join(' ');
  }
}

// =============================================================================
// Exports
// =============================================================================

export default RiskPredictor;
