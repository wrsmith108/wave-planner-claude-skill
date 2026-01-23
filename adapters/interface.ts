/**
 * PM Tool Adapter Interface
 *
 * Abstract interface for project management tool integrations.
 * Implementations: LinearAdapter, GitHubAdapter, JiraAdapter
 */

// ============================================================================
// Core Types
// ============================================================================

export type Priority = 'P0-Critical' | 'P1-High' | 'P2-Medium' | 'P3-Low';

export type IssueStateType =
  | 'backlog'
  | 'unstarted'
  | 'started'
  | 'completed'
  | 'canceled';

export interface User {
  id: string;
  name: string;
  email?: string;
}

export interface Label {
  id: string;
  name: string;
  color?: string;
  description?: string;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  state?: string;
  url?: string;
}

export interface Milestone {
  id: string;
  name: string;
  description?: string;
  targetDate?: Date;
  project?: Project;
}

export interface IssueState {
  id: string;
  name: string;
  type: IssueStateType;
  color?: string;
}

export interface Issue {
  id: string;
  identifier: string;      // "SMI-123", "#456", "PROJ-789"
  title: string;
  description: string;
  priority: Priority;
  state: IssueState;
  labels: Label[];
  parent?: Issue;
  children?: Issue[];
  project?: Project;
  milestone?: Milestone;
  assignee?: User;
  estimate?: number;       // Story points or similar
  url?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface Comment {
  id: string;
  body: string;
  author: User;
  createdAt: Date;
}

export interface Resource {
  url: string;
  label: string;
  type?: 'document' | 'repository' | 'external';
}

export interface ProjectUpdate {
  body: string;
  health?: 'onTrack' | 'atRisk' | 'offTrack';
}

// ============================================================================
// Filter Types
// ============================================================================

export interface IssueFilter {
  projectId?: string;
  milestoneId?: string;
  priority?: Priority[];
  state?: IssueStateType[];
  labels?: string[];
  assignee?: string;        // User ID or "me"
  search?: string;          // Full-text search
  limit?: number;
}

// ============================================================================
// Input Types
// ============================================================================

export interface CreateIssueInput {
  title: string;
  description?: string;
  priority?: Priority;
  state?: string;           // State name or ID
  labels?: string[];        // Label names or IDs
  assignee?: string;        // User ID or "me"
  estimate?: number;
  projectId?: string;
  milestoneId?: string;
  parentId?: string;        // For sub-issues
}

export interface UpdateIssueInput {
  title?: string;
  description?: string;
  priority?: Priority;
  state?: string;
  labels?: string[];
  assignee?: string;
  estimate?: number;
  projectId?: string;
  parentId?: string;
}

// ============================================================================
// Adapter Interface
// ============================================================================

export interface PMAdapter {
  // -------------------------------------------------------------------------
  // Identity
  // -------------------------------------------------------------------------

  /** Adapter name: "linear", "github", "jira" */
  readonly name: string;

  /** Human-readable display name */
  readonly displayName: string;

  /** Check if adapter is properly configured */
  isConfigured(): Promise<boolean>;

  // -------------------------------------------------------------------------
  // Discovery
  // -------------------------------------------------------------------------

  /** List all accessible projects */
  listProjects(): Promise<Project[]>;

  /** Get a specific project by ID or name */
  getProject(idOrName: string): Promise<Project | null>;

  /** List milestones/cycles for a project */
  listMilestones(projectId: string): Promise<Milestone[]>;

  // -------------------------------------------------------------------------
  // Issue Operations
  // -------------------------------------------------------------------------

  /** Get a single issue by ID or identifier */
  getIssue(idOrIdentifier: string): Promise<Issue | null>;

  /** List issues with optional filters */
  listIssues(filter?: IssueFilter): Promise<Issue[]>;

  /** Create a new issue */
  createIssue(data: CreateIssueInput): Promise<Issue>;

  /** Create a sub-issue under a parent */
  createSubIssue(parentId: string, data: CreateIssueInput): Promise<Issue>;

  /** Update an existing issue */
  updateIssue(id: string, data: UpdateIssueInput): Promise<Issue>;

  /** Add a comment to an issue */
  addComment(issueId: string, body: string): Promise<Comment>;

  // -------------------------------------------------------------------------
  // Labels
  // -------------------------------------------------------------------------

  /** List all available labels */
  listLabels(teamId?: string): Promise<Label[]>;

  /** Apply labels to an issue */
  applyLabels(issueId: string, labelIds: string[]): Promise<void>;

  /** Get or create a label by name */
  ensureLabel(name: string, teamId?: string): Promise<Label>;

  // -------------------------------------------------------------------------
  // Project Operations
  // -------------------------------------------------------------------------

  /** Link an external resource to a project */
  linkResourceToProject(projectId: string, resource: Resource): Promise<void>;

  /** Create a project status update */
  createProjectUpdate(projectId: string, update: ProjectUpdate): Promise<void>;

  /** Update project status */
  updateProjectStatus(projectId: string, status: string): Promise<void>;

  // -------------------------------------------------------------------------
  // Utilities
  // -------------------------------------------------------------------------

  /** Convert priority string to adapter-specific value */
  normalizePriority(priority: string): Priority;

  /** Convert state string to adapter-specific value */
  normalizeState(state: string): IssueStateType;

  /** Build a URL for an issue */
  buildIssueUrl(issue: Issue): string;

  /** Build a URL for a project */
  buildProjectUrl(project: Project): string;
}

// ============================================================================
// Adapter Factory
// ============================================================================

export type AdapterType = 'linear' | 'github' | 'jira';

export interface AdapterConfig {
  type: AdapterType;
  apiKey?: string;
  baseUrl?: string;
  teamId?: string;
}

/**
 * Factory function type for creating adapters
 */
export type AdapterFactory = (config: AdapterConfig) => PMAdapter;

/**
 * Registry of available adapters
 */
export const adapterRegistry: Map<AdapterType, AdapterFactory> = new Map();

/**
 * Register an adapter factory
 */
export function registerAdapter(type: AdapterType, factory: AdapterFactory): void {
  adapterRegistry.set(type, factory);
}

/**
 * Create an adapter instance
 */
export function createAdapter(config: AdapterConfig): PMAdapter {
  const factory = adapterRegistry.get(config.type);
  if (!factory) {
    throw new Error(`Unknown adapter type: ${config.type}`);
  }
  return factory(config);
}

/**
 * Detect the appropriate adapter based on environment
 */
export async function detectAdapter(): Promise<AdapterType | null> {
  // Check for Linear API key
  if (process.env.LINEAR_API_KEY) {
    return 'linear';
  }

  // Check for GitHub token
  if (process.env.GITHUB_TOKEN || process.env.GH_TOKEN) {
    return 'github';
  }

  // Check for Jira credentials
  if (process.env.JIRA_API_TOKEN && process.env.JIRA_BASE_URL) {
    return 'jira';
  }

  return null;
}

// ============================================================================
// Error Types
// ============================================================================

export class AdapterError extends Error {
  constructor(
    message: string,
    public readonly adapter: string,
    public readonly operation: string,
    public readonly cause?: Error
  ) {
    super(`[${adapter}] ${operation}: ${message}`);
    this.name = 'AdapterError';
  }
}

export class NotFoundError extends AdapterError {
  constructor(adapter: string, resource: string, id: string) {
    super(`${resource} not found: ${id}`, adapter, 'lookup');
    this.name = 'NotFoundError';
  }
}

export class AuthenticationError extends AdapterError {
  constructor(adapter: string) {
    super('Authentication failed or credentials missing', adapter, 'auth');
    this.name = 'AuthenticationError';
  }
}

export class RateLimitError extends AdapterError {
  constructor(adapter: string, retryAfter?: number) {
    super(
      `Rate limit exceeded${retryAfter ? `, retry after ${retryAfter}s` : ''}`,
      adapter,
      'rateLimit'
    );
    this.name = 'RateLimitError';
  }
}
