/**
 * Linear PM Adapter
 *
 * Implements PMAdapter interface for Linear.app integration.
 * Uses the existing Linear skill for operations.
 */

import {
  PMAdapter,
  Project,
  Milestone,
  Issue,
  IssueFilter,
  CreateIssueInput,
  UpdateIssueInput,
  Comment,
  Label,
  Resource,
  ProjectUpdate,
  Priority,
  IssueState,
  IssueStateType,
  AdapterError,
  NotFoundError,
  AuthenticationError,
  registerAdapter,
} from './interface';

// ============================================================================
// Linear Adapter Implementation
// ============================================================================

export class LinearAdapter implements PMAdapter {
  readonly name = 'linear';
  readonly displayName = 'Linear';

  private teamId?: string;
  private apiKey?: string;

  constructor(config: { apiKey?: string; teamId?: string } = {}) {
    this.apiKey = config.apiKey || process.env.LINEAR_API_KEY;
    this.teamId = config.teamId;
  }

  // -------------------------------------------------------------------------
  // Configuration
  // -------------------------------------------------------------------------

  async isConfigured(): Promise<boolean> {
    if (!this.apiKey) {
      return false;
    }

    try {
      // Verify credentials with a simple query
      await this.query('query { viewer { id } }');
      return true;
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Discovery
  // -------------------------------------------------------------------------

  async listProjects(): Promise<Project[]> {
    const result = await this.query(`
      query {
        projects(first: 50) {
          nodes {
            id
            name
            description
            state
            url
          }
        }
      }
    `);

    return result.projects.nodes.map(this.mapProject);
  }

  async getProject(idOrName: string): Promise<Project | null> {
    // Try by ID first
    try {
      const result = await this.query(`
        query($id: String!) {
          project(id: $id) {
            id
            name
            description
            state
            url
          }
        }
      `, { id: idOrName });

      if (result.project) {
        return this.mapProject(result.project);
      }
    } catch {
      // Not found by ID, try by name
    }

    // Search by name
    const projects = await this.listProjects();
    const match = projects.find(
      p => p.name.toLowerCase().includes(idOrName.toLowerCase())
    );

    return match || null;
  }

  async listMilestones(projectId: string): Promise<Milestone[]> {
    const result = await this.query(`
      query($projectId: String!) {
        project(id: $projectId) {
          projectMilestones {
            nodes {
              id
              name
              description
              targetDate
            }
          }
        }
      }
    `, { projectId });

    return (result.project?.projectMilestones?.nodes || []).map((m: any) => ({
      id: m.id,
      name: m.name,
      description: m.description,
      targetDate: m.targetDate ? new Date(m.targetDate) : undefined,
    }));
  }

  // -------------------------------------------------------------------------
  // Issue Operations
  // -------------------------------------------------------------------------

  async getIssue(idOrIdentifier: string): Promise<Issue | null> {
    // Check if it's an identifier (e.g., "SMI-123")
    const isIdentifier = /^[A-Z]+-\d+$/.test(idOrIdentifier);

    if (isIdentifier) {
      const result = await this.query(`
        query($identifier: String!) {
          issue(id: $identifier) {
            ${this.issueFragment}
          }
        }
      `, { identifier: idOrIdentifier });

      return result.issue ? this.mapIssue(result.issue) : null;
    }

    // Try by UUID
    const result = await this.query(`
      query($id: String!) {
        issue(id: $id) {
          ${this.issueFragment}
        }
      }
    `, { id: idOrIdentifier });

    return result.issue ? this.mapIssue(result.issue) : null;
  }

  async listIssues(filter?: IssueFilter): Promise<Issue[]> {
    const filterObj: any = {};

    if (filter?.projectId) {
      filterObj.project = { id: { eq: filter.projectId } };
    }

    if (filter?.priority?.length) {
      filterObj.priority = { in: filter.priority.map(this.priorityToNumber) };
    }

    if (filter?.state?.length) {
      filterObj.state = { type: { in: filter.state } };
    }

    if (filter?.labels?.length) {
      filterObj.labels = { some: { name: { in: filter.labels } } };
    }

    if (filter?.assignee) {
      if (filter.assignee === 'me') {
        filterObj.assignee = { isMe: { eq: true } };
      } else {
        filterObj.assignee = { id: { eq: filter.assignee } };
      }
    }

    const result = await this.query(`
      query($filter: IssueFilter, $limit: Int) {
        issues(filter: $filter, first: $limit) {
          nodes {
            ${this.issueFragment}
          }
        }
      }
    `, {
      filter: Object.keys(filterObj).length > 0 ? filterObj : undefined,
      limit: filter?.limit || 50,
    });

    return result.issues.nodes.map((i: any) => this.mapIssue(i));
  }

  async createIssue(data: CreateIssueInput): Promise<Issue> {
    const input: any = {
      title: data.title,
      description: data.description,
      teamId: this.teamId,
    };

    if (data.priority) {
      input.priority = this.priorityToNumber(data.priority);
    }

    if (data.state) {
      // Need to look up state ID
      const stateId = await this.getStateId(data.state);
      if (stateId) input.stateId = stateId;
    }

    if (data.labels?.length) {
      const labelIds = await this.getLabelIds(data.labels);
      if (labelIds.length) input.labelIds = labelIds;
    }

    if (data.assignee) {
      input.assigneeId = data.assignee === 'me'
        ? await this.getCurrentUserId()
        : data.assignee;
    }

    if (data.projectId) {
      input.projectId = data.projectId;
    }

    if (data.parentId) {
      input.parentId = data.parentId;
    }

    if (data.estimate) {
      input.estimate = data.estimate;
    }

    const result = await this.query(`
      mutation($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue {
            ${this.issueFragment}
          }
        }
      }
    `, { input });

    if (!result.issueCreate.success) {
      throw new AdapterError('Failed to create issue', this.name, 'createIssue');
    }

    return this.mapIssue(result.issueCreate.issue);
  }

  async createSubIssue(parentId: string, data: CreateIssueInput): Promise<Issue> {
    return this.createIssue({ ...data, parentId });
  }

  async updateIssue(id: string, data: UpdateIssueInput): Promise<Issue> {
    const input: any = {};

    if (data.title !== undefined) input.title = data.title;
    if (data.description !== undefined) input.description = data.description;

    if (data.priority) {
      input.priority = this.priorityToNumber(data.priority);
    }

    if (data.state) {
      const stateId = await this.getStateId(data.state);
      if (stateId) input.stateId = stateId;
    }

    if (data.labels) {
      const labelIds = await this.getLabelIds(data.labels);
      input.labelIds = labelIds;
    }

    if (data.assignee) {
      input.assigneeId = data.assignee === 'me'
        ? await this.getCurrentUserId()
        : data.assignee;
    }

    if (data.projectId) {
      input.projectId = data.projectId;
    }

    if (data.parentId) {
      input.parentId = data.parentId;
    }

    const result = await this.query(`
      mutation($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) {
          success
          issue {
            ${this.issueFragment}
          }
        }
      }
    `, { id, input });

    if (!result.issueUpdate.success) {
      throw new AdapterError('Failed to update issue', this.name, 'updateIssue');
    }

    return this.mapIssue(result.issueUpdate.issue);
  }

  async addComment(issueId: string, body: string): Promise<Comment> {
    const result = await this.query(`
      mutation($issueId: String!, $body: String!) {
        commentCreate(input: { issueId: $issueId, body: $body }) {
          success
          comment {
            id
            body
            createdAt
            user {
              id
              name
            }
          }
        }
      }
    `, { issueId, body });

    if (!result.commentCreate.success) {
      throw new AdapterError('Failed to add comment', this.name, 'addComment');
    }

    const c = result.commentCreate.comment;
    return {
      id: c.id,
      body: c.body,
      author: { id: c.user.id, name: c.user.name },
      createdAt: new Date(c.createdAt),
    };
  }

  // -------------------------------------------------------------------------
  // Labels
  // -------------------------------------------------------------------------

  async listLabels(teamId?: string): Promise<Label[]> {
    const result = await this.query(`
      query($teamId: String) {
        issueLabels(filter: { team: { id: { eq: $teamId } } }, first: 100) {
          nodes {
            id
            name
            color
            description
          }
        }
      }
    `, { teamId: teamId || this.teamId });

    return result.issueLabels.nodes.map((l: any) => ({
      id: l.id,
      name: l.name,
      color: l.color,
      description: l.description,
    }));
  }

  async applyLabels(issueId: string, labelIds: string[]): Promise<void> {
    await this.updateIssue(issueId, { labels: labelIds });
  }

  async ensureLabel(name: string, teamId?: string): Promise<Label> {
    const labels = await this.listLabels(teamId);
    const existing = labels.find(
      l => l.name.toLowerCase() === name.toLowerCase()
    );

    if (existing) return existing;

    // Create new label
    const result = await this.query(`
      mutation($teamId: String!, $name: String!) {
        issueLabelCreate(input: { teamId: $teamId, name: $name }) {
          success
          issueLabel {
            id
            name
            color
          }
        }
      }
    `, { teamId: teamId || this.teamId, name });

    if (!result.issueLabelCreate.success) {
      throw new AdapterError('Failed to create label', this.name, 'ensureLabel');
    }

    return {
      id: result.issueLabelCreate.issueLabel.id,
      name: result.issueLabelCreate.issueLabel.name,
      color: result.issueLabelCreate.issueLabel.color,
    };
  }

  // -------------------------------------------------------------------------
  // Project Operations
  // -------------------------------------------------------------------------

  async linkResourceToProject(projectId: string, resource: Resource): Promise<void> {
    await this.query(`
      mutation($projectId: String!, $url: String!, $label: String!) {
        entityExternalLinkCreate(input: {
          projectId: $projectId,
          url: $url,
          label: $label
        }) {
          success
        }
      }
    `, {
      projectId,
      url: resource.url,
      label: resource.label,
    });
  }

  async createProjectUpdate(projectId: string, update: ProjectUpdate): Promise<void> {
    await this.query(`
      mutation($projectId: String!, $body: String!, $health: ProjectUpdateHealthType) {
        projectUpdateCreate(input: {
          projectId: $projectId,
          body: $body,
          health: $health
        }) {
          success
        }
      }
    `, {
      projectId,
      body: update.body,
      health: update.health,
    });
  }

  async updateProjectStatus(projectId: string, status: string): Promise<void> {
    // Look up status ID
    const result = await this.query(`
      query {
        projectStatuses {
          nodes {
            id
            name
          }
        }
      }
    `);

    const statusObj = result.projectStatuses.nodes.find(
      (s: any) => s.name.toLowerCase() === status.toLowerCase()
    );

    if (!statusObj) {
      throw new NotFoundError(this.name, 'ProjectStatus', status);
    }

    await this.query(`
      mutation($projectId: String!, $statusId: String!) {
        projectUpdate(id: $projectId, input: { statusId: $statusId }) {
          success
        }
      }
    `, { projectId, statusId: statusObj.id });
  }

  // -------------------------------------------------------------------------
  // Utilities
  // -------------------------------------------------------------------------

  normalizePriority(priority: string): Priority {
    const map: Record<string, Priority> = {
      urgent: 'P0-Critical',
      high: 'P1-High',
      medium: 'P2-Medium',
      low: 'P3-Low',
      '0': 'P0-Critical',
      '1': 'P1-High',
      '2': 'P2-Medium',
      '3': 'P3-Low',
      '4': 'P3-Low',
    };

    const normalized = priority.toLowerCase();
    return map[normalized] || 'P2-Medium';
  }

  normalizeState(state: string): IssueStateType {
    const map: Record<string, IssueStateType> = {
      backlog: 'backlog',
      todo: 'unstarted',
      'in progress': 'started',
      'in review': 'started',
      done: 'completed',
      canceled: 'canceled',
      cancelled: 'canceled',
    };

    const normalized = state.toLowerCase();
    return map[normalized] || 'unstarted';
  }

  buildIssueUrl(issue: Issue): string {
    return issue.url || `https://linear.app/issue/${issue.identifier}`;
  }

  buildProjectUrl(project: Project): string {
    return project.url || `https://linear.app/project/${project.id}`;
  }

  // -------------------------------------------------------------------------
  // Private Helpers
  // -------------------------------------------------------------------------

  private async query(query: string, variables?: Record<string, any>): Promise<any> {
    if (!this.apiKey) {
      throw new AuthenticationError(this.name);
    }

    const response = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.apiKey,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new AuthenticationError(this.name);
      }
      throw new AdapterError(
        `HTTP ${response.status}: ${response.statusText}`,
        this.name,
        'query'
      );
    }

    const result = await response.json();

    if (result.errors?.length) {
      throw new AdapterError(
        result.errors[0].message,
        this.name,
        'query'
      );
    }

    return result.data;
  }

  private readonly issueFragment = `
    id
    identifier
    title
    description
    priority
    url
    createdAt
    updatedAt
    state {
      id
      name
      type
      color
    }
    labels {
      nodes {
        id
        name
        color
      }
    }
    assignee {
      id
      name
      email
    }
    project {
      id
      name
    }
    parent {
      id
      identifier
      title
    }
    children {
      nodes {
        id
        identifier
        title
      }
    }
    estimate
  `;

  private mapProject(p: any): Project {
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      state: p.state,
      url: p.url,
    };
  }

  private mapIssue(i: any): Issue {
    return {
      id: i.id,
      identifier: i.identifier,
      title: i.title,
      description: i.description || '',
      priority: this.numberToPriority(i.priority),
      state: {
        id: i.state.id,
        name: i.state.name,
        type: i.state.type,
        color: i.state.color,
      },
      labels: (i.labels?.nodes || []).map((l: any) => ({
        id: l.id,
        name: l.name,
        color: l.color,
      })),
      assignee: i.assignee ? {
        id: i.assignee.id,
        name: i.assignee.name,
        email: i.assignee.email,
      } : undefined,
      project: i.project ? {
        id: i.project.id,
        name: i.project.name,
      } : undefined,
      parent: i.parent ? {
        id: i.parent.id,
        identifier: i.parent.identifier,
        title: i.parent.title,
        description: '',
        priority: 'P2-Medium',
        state: { id: '', name: '', type: 'unstarted' },
        labels: [],
      } : undefined,
      children: i.children?.nodes?.map((c: any) => ({
        id: c.id,
        identifier: c.identifier,
        title: c.title,
        description: '',
        priority: 'P2-Medium' as Priority,
        state: { id: '', name: '', type: 'unstarted' as IssueStateType },
        labels: [],
      })),
      estimate: i.estimate,
      url: i.url,
      createdAt: i.createdAt ? new Date(i.createdAt) : undefined,
      updatedAt: i.updatedAt ? new Date(i.updatedAt) : undefined,
    };
  }

  private priorityToNumber(priority: Priority): number {
    const map: Record<Priority, number> = {
      'P0-Critical': 1,
      'P1-High': 2,
      'P2-Medium': 3,
      'P3-Low': 4,
    };
    return map[priority] || 3;
  }

  private numberToPriority(num: number): Priority {
    const map: Record<number, Priority> = {
      0: 'P3-Low',      // No priority
      1: 'P0-Critical', // Urgent
      2: 'P1-High',     // High
      3: 'P2-Medium',   // Medium
      4: 'P3-Low',      // Low
    };
    return map[num] || 'P2-Medium';
  }

  private async getStateId(stateName: string): Promise<string | null> {
    const result = await this.query(`
      query($teamId: String) {
        workflowStates(filter: { team: { id: { eq: $teamId } } }) {
          nodes {
            id
            name
          }
        }
      }
    `, { teamId: this.teamId });

    const state = result.workflowStates.nodes.find(
      (s: any) => s.name.toLowerCase() === stateName.toLowerCase()
    );

    return state?.id || null;
  }

  private async getLabelIds(labels: string[]): Promise<string[]> {
    const allLabels = await this.listLabels();
    const labelMap = new Map(
      allLabels.map(l => [l.name.toLowerCase(), l.id])
    );

    return labels
      .map(name => labelMap.get(name.toLowerCase()))
      .filter((id): id is string => id !== undefined);
  }

  private async getCurrentUserId(): Promise<string> {
    const result = await this.query('query { viewer { id } }');
    return result.viewer.id;
  }
}

// Register the adapter
registerAdapter('linear', (config) => new LinearAdapter(config));

export default LinearAdapter;
