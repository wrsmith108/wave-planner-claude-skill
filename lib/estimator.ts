/**
 * Token Estimator Module
 *
 * Dynamic token estimation based on codebase analysis.
 * Estimates context loading, implementation, tests, review, and documentation overhead.
 */

import { Issue } from '../adapters/interface';

// ============================================================================
// Types
// ============================================================================

export interface FileInfo {
  path: string;
  lines: number;
  language: string;
  complexity: Complexity;
}

export type Complexity = 'low' | 'medium' | 'high';
export type Confidence = 'low' | 'medium' | 'high';

export interface TokenEstimate {
  total: number;
  breakdown: TokenBreakdown;
  confidence: Confidence;
  assumptions: string[];
  filesAnalyzed: number;
}

export interface TokenBreakdown {
  codebaseContext: number;    // Reading existing code
  implementation: number;      // Writing new code
  tests: number;              // TDD test code
  review: number;             // Governance review overhead
  documentation: number;      // Inline docs, comments
}

export interface CodebaseContext {
  filesLikelyTouched: FileInfo[];
  relatedFiles: FileInfo[];
  totalLines: number;
  avgComplexity: Complexity;
}

export interface EstimationConfig {
  multipliers: {
    contextExpansion: number;   // Related files multiplier (default: 1.5)
    testOverhead: number;       // Tests as % of implementation (default: 0.6)
    reviewOverhead: number;     // Review as % of (impl + tests) (default: 0.3)
    documentation: number;      // Docs as % of implementation (default: 0.1)
  };
  complexity: Record<Complexity, number>;
  priority: Record<string, number>;
  reviewCycles: number;
}

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULT_CONFIG: EstimationConfig = {
  multipliers: {
    contextExpansion: 1.5,
    testOverhead: 0.6,
    reviewOverhead: 0.3,
    documentation: 0.1,
  },
  complexity: {
    low: 1.0,
    medium: 1.5,
    high: 2.5,
  },
  priority: {
    'P0-Critical': 1.5,
    'P1-High': 1.2,
    'P2-Medium': 1.0,
    'P3-Low': 0.8,
  },
  reviewCycles: 2,
};

// ============================================================================
// Token Estimator
// ============================================================================

export class TokenEstimator {
  private config: EstimationConfig;

  constructor(config: Partial<EstimationConfig> = {}) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      multipliers: { ...DEFAULT_CONFIG.multipliers, ...config.multipliers },
      complexity: { ...DEFAULT_CONFIG.complexity, ...config.complexity },
      priority: { ...DEFAULT_CONFIG.priority, ...config.priority },
    };
  }

  /**
   * Estimate tokens for a single issue
   */
  estimate(issue: Issue, context: CodebaseContext): TokenEstimate {
    const assumptions: string[] = [];

    // Base overhead for system prompt and tool calls
    const BASE_OVERHEAD = 5000;

    // Context loading (existing code to read)
    const contextTokens = this.estimateContextTokens(context, assumptions);

    // Implementation (new code to write)
    const implTokens = this.estimateImplementationTokens(issue, context, assumptions);

    // TDD overhead
    const testTokens = Math.round(implTokens * this.config.multipliers.testOverhead);
    assumptions.push(`Tests estimated at ${this.config.multipliers.testOverhead * 100}% of implementation`);

    // Review cycles
    const reviewTokens = Math.round(
      (implTokens + testTokens) *
      this.config.multipliers.reviewOverhead *
      this.config.reviewCycles
    );
    assumptions.push(`${this.config.reviewCycles} review cycles at ${this.config.multipliers.reviewOverhead * 100}% overhead each`);

    // Documentation
    const docTokens = Math.round(implTokens * this.config.multipliers.documentation);

    const total = BASE_OVERHEAD + contextTokens + implTokens + testTokens + reviewTokens + docTokens;

    return {
      total,
      breakdown: {
        codebaseContext: contextTokens,
        implementation: implTokens,
        tests: testTokens,
        review: reviewTokens,
        documentation: docTokens,
      },
      confidence: this.calculateConfidence(issue, context),
      assumptions,
      filesAnalyzed: context.filesLikelyTouched.length + context.relatedFiles.length,
    };
  }

  /**
   * Estimate tokens for multiple issues (wave)
   */
  estimateWave(issues: Issue[], contexts: Map<string, CodebaseContext>): TokenEstimate {
    const estimates = issues.map(issue => {
      const context = contexts.get(issue.id) || this.createEmptyContext();
      return this.estimate(issue, context);
    });

    // Combine estimates with shared context deduplication
    const sharedContextReduction = this.calculateSharedContextReduction(issues, contexts);

    const totalBreakdown: TokenBreakdown = {
      codebaseContext: 0,
      implementation: 0,
      tests: 0,
      review: 0,
      documentation: 0,
    };

    const allAssumptions: string[] = [];

    for (const est of estimates) {
      totalBreakdown.codebaseContext += est.breakdown.codebaseContext;
      totalBreakdown.implementation += est.breakdown.implementation;
      totalBreakdown.tests += est.breakdown.tests;
      totalBreakdown.review += est.breakdown.review;
      totalBreakdown.documentation += est.breakdown.documentation;
      allAssumptions.push(...est.assumptions);
    }

    // Apply shared context reduction
    totalBreakdown.codebaseContext = Math.round(
      totalBreakdown.codebaseContext * (1 - sharedContextReduction)
    );

    if (sharedContextReduction > 0) {
      allAssumptions.push(
        `Shared context reduction: ${Math.round(sharedContextReduction * 100)}%`
      );
    }

    const total = Object.values(totalBreakdown).reduce((a, b) => a + b, 0);

    return {
      total,
      breakdown: totalBreakdown,
      confidence: this.aggregateConfidence(estimates),
      assumptions: [...new Set(allAssumptions)], // Dedupe
      filesAnalyzed: estimates.reduce((sum, e) => sum + e.filesAnalyzed, 0),
    };
  }

  // -------------------------------------------------------------------------
  // Private Methods
  // -------------------------------------------------------------------------

  private estimateContextTokens(
    context: CodebaseContext,
    assumptions: string[]
  ): number {
    // ~2 tokens per character, ~50 characters per line average
    const TOKENS_PER_LINE = 100;

    const directTokens = context.filesLikelyTouched.reduce(
      (sum, f) => sum + f.lines * TOKENS_PER_LINE,
      0
    );

    const relatedTokens = context.relatedFiles.reduce(
      (sum, f) => sum + f.lines * TOKENS_PER_LINE,
      0
    );

    const contextTokens = directTokens + Math.round(
      relatedTokens * this.config.multipliers.contextExpansion
    );

    assumptions.push(
      `${context.filesLikelyTouched.length} direct files, ` +
      `${context.relatedFiles.length} related files`
    );

    return contextTokens;
  }

  private estimateImplementationTokens(
    issue: Issue,
    context: CodebaseContext,
    assumptions: string[]
  ): number {
    const TOKENS_PER_LINE = 100;

    // Base estimate from lines likely to be touched/written
    const baseTokens = context.totalLines * 2 * TOKENS_PER_LINE;

    // Apply complexity multiplier
    const complexityMult = this.config.complexity[context.avgComplexity];
    assumptions.push(`Complexity: ${context.avgComplexity} (${complexityMult}x)`);

    // Apply priority multiplier
    const priorityMult = this.config.priority[issue.priority] || 1.0;
    assumptions.push(`Priority: ${issue.priority} (${priorityMult}x)`);

    return Math.round(baseTokens * complexityMult * priorityMult);
  }

  private calculateConfidence(issue: Issue, context: CodebaseContext): Confidence {
    let score = 0;

    // More files analyzed = higher confidence
    if (context.filesLikelyTouched.length >= 3) score += 2;
    else if (context.filesLikelyTouched.length >= 1) score += 1;

    // Clear description = higher confidence
    if (issue.description && issue.description.length > 200) score += 2;
    else if (issue.description && issue.description.length > 50) score += 1;

    // Labels provide context
    if (issue.labels.length >= 2) score += 1;

    // Estimate provided = more clarity
    if (issue.estimate) score += 1;

    if (score >= 5) return 'high';
    if (score >= 3) return 'medium';
    return 'low';
  }

  private aggregateConfidence(estimates: TokenEstimate[]): Confidence {
    const scores = estimates.map(e => {
      switch (e.confidence) {
        case 'high': return 3;
        case 'medium': return 2;
        case 'low': return 1;
      }
    });

    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;

    if (avg >= 2.5) return 'high';
    if (avg >= 1.5) return 'medium';
    return 'low';
  }

  private calculateSharedContextReduction(
    issues: Issue[],
    contexts: Map<string, CodebaseContext>
  ): number {
    if (issues.length < 2) return 0;

    // Calculate file overlap between issues
    const allFiles = new Set<string>();
    const sharedFiles = new Set<string>();

    for (const issue of issues) {
      const ctx = contexts.get(issue.id);
      if (!ctx) continue;

      const files = [
        ...ctx.filesLikelyTouched.map(f => f.path),
        ...ctx.relatedFiles.map(f => f.path),
      ];

      for (const file of files) {
        if (allFiles.has(file)) {
          sharedFiles.add(file);
        }
        allFiles.add(file);
      }
    }

    // Reduction proportional to shared files
    if (allFiles.size === 0) return 0;

    const overlapRatio = sharedFiles.size / allFiles.size;

    // Cap reduction at 50% to be conservative
    return Math.min(overlapRatio * 0.7, 0.5);
  }

  private createEmptyContext(): CodebaseContext {
    return {
      filesLikelyTouched: [],
      relatedFiles: [],
      totalLines: 50, // Assume at least some work
      avgComplexity: 'medium',
    };
  }
}

// ============================================================================
// Codebase Analyzer
// ============================================================================

export class CodebaseAnalyzer {
  /**
   * Analyze which files an issue is likely to touch
   */
  async analyzeIssue(issue: Issue, projectRoot: string): Promise<CodebaseContext> {
    const filesLikelyTouched: FileInfo[] = [];
    const relatedFiles: FileInfo[] = [];

    // Extract file paths mentioned in issue
    const mentionedPaths = this.extractFilePaths(issue.description);

    // Extract keywords for searching
    const keywords = this.extractKeywords(issue.title + ' ' + issue.description);

    // Search for files matching keywords
    const searchedFiles = await this.searchCodebase(keywords, projectRoot);

    // Categorize files
    for (const path of mentionedPaths) {
      const info = await this.getFileInfo(path, projectRoot);
      if (info) filesLikelyTouched.push(info);
    }

    for (const path of searchedFiles) {
      if (!mentionedPaths.includes(path)) {
        const info = await this.getFileInfo(path, projectRoot);
        if (info) {
          // Check if it's a test file
          if (this.isTestFile(path)) {
            relatedFiles.push(info);
          } else {
            filesLikelyTouched.push(info);
          }
        }
      }
    }

    // Find related files (imports, tests)
    const additionalRelated = await this.findRelatedFiles(
      filesLikelyTouched.map(f => f.path),
      projectRoot
    );

    for (const path of additionalRelated) {
      const existing = [...filesLikelyTouched, ...relatedFiles].find(f => f.path === path);
      if (!existing) {
        const info = await this.getFileInfo(path, projectRoot);
        if (info) relatedFiles.push(info);
      }
    }

    // Calculate totals
    const totalLines = filesLikelyTouched.reduce((sum, f) => sum + f.lines, 0);
    const avgComplexity = this.calculateAvgComplexity(filesLikelyTouched);

    return {
      filesLikelyTouched,
      relatedFiles,
      totalLines,
      avgComplexity,
    };
  }

  // -------------------------------------------------------------------------
  // Private Methods
  // -------------------------------------------------------------------------

  private extractFilePaths(text: string): string[] {
    if (!text) return [];

    // Match common file path patterns
    const patterns = [
      /(?:^|\s)((?:src|lib|packages|tests?)\/[\w\-./]+\.\w+)/g,
      /`([^`]+\.\w{2,4})`/g,
      /\[([^\]]+\.\w{2,4})\]/g,
    ];

    const paths = new Set<string>();

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        paths.add(match[1]);
      }
    }

    return [...paths];
  }

  private extractKeywords(text: string): string[] {
    if (!text) return [];

    // Remove common words and extract meaningful terms
    const stopWords = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'to', 'of',
      'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through',
      'during', 'before', 'after', 'above', 'below', 'between', 'under',
      'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where',
      'why', 'how', 'all', 'each', 'few', 'more', 'most', 'other', 'some',
      'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too',
      'very', 'just', 'also', 'now', 'and', 'but', 'or', 'if', 'because',
      'until', 'while', 'this', 'that', 'these', 'those', 'it', 'its',
    ]);

    const words = text
      .toLowerCase()
      .replace(/[^\w\s-]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w));

    // Also extract camelCase and PascalCase terms
    const camelTerms = text.match(/[a-z]+[A-Z][a-zA-Z]*/g) || [];
    const pascalTerms = text.match(/[A-Z][a-z]+[A-Z][a-zA-Z]*/g) || [];

    return [...new Set([...words, ...camelTerms, ...pascalTerms])].slice(0, 20);
  }

  private async searchCodebase(keywords: string[], projectRoot: string): Promise<string[]> {
    // This would use grep/ripgrep in practice
    // For now, return empty array - actual implementation would search
    return [];
  }

  private async getFileInfo(path: string, projectRoot: string): Promise<FileInfo | null> {
    // This would read actual file stats
    // For now, return estimated info based on path
    const ext = path.split('.').pop() || '';
    const language = this.extToLanguage(ext);

    return {
      path,
      lines: 100, // Default estimate
      language,
      complexity: 'medium',
    };
  }

  private async findRelatedFiles(paths: string[], projectRoot: string): Promise<string[]> {
    const related: string[] = [];

    for (const path of paths) {
      // Find test files
      const testPath = this.guessTestPath(path);
      if (testPath) related.push(testPath);

      // Would also find imports here in practice
    }

    return related;
  }

  private isTestFile(path: string): boolean {
    return /\.(test|spec)\.\w+$/.test(path) || path.includes('/tests/') || path.includes('/__tests__/');
  }

  private guessTestPath(path: string): string | null {
    // src/foo.ts -> tests/foo.test.ts
    if (path.startsWith('src/')) {
      const testPath = path
        .replace(/^src\//, 'tests/')
        .replace(/\.(\w+)$/, '.test.$1');
      return testPath;
    }
    return null;
  }

  private extToLanguage(ext: string): string {
    const map: Record<string, string> = {
      ts: 'typescript',
      tsx: 'typescript',
      js: 'javascript',
      jsx: 'javascript',
      py: 'python',
      go: 'go',
      rs: 'rust',
      java: 'java',
      rb: 'ruby',
      md: 'markdown',
      yaml: 'yaml',
      yml: 'yaml',
      json: 'json',
    };
    return map[ext] || 'unknown';
  }

  private calculateAvgComplexity(files: FileInfo[]): Complexity {
    if (files.length === 0) return 'medium';

    const scores = files.map(f => {
      switch (f.complexity) {
        case 'high': return 3;
        case 'medium': return 2;
        case 'low': return 1;
      }
    });

    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;

    if (avg >= 2.5) return 'high';
    if (avg >= 1.5) return 'medium';
    return 'low';
  }
}

// ============================================================================
// Exports
// ============================================================================

export const estimator = new TokenEstimator();
export const analyzer = new CodebaseAnalyzer();

export default TokenEstimator;
