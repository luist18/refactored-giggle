import * as github from '@actions/github'
import { createApiClient, type Branch } from '@neondatabase/api-client'
import { createPatch } from 'diff'

export type BranchDiff = {
  sqlDiff: string
  parentBranch: Branch
  childBranch: Branch
  role: string
  database: string
}

export async function schemaDiff(
  projectId: string,
  branchName: string,
  apiKey: string,
  apiHost: string,
  username?: string,
  database?: string
): Promise<BranchDiff> {
  const api = createApiClient({
    apiKey,
    baseURL: apiHost,
    timeout: 60000,
    headers: {
      // get the action version from the package.json
      'User-Agent': `neon-schema-diff-action v0.0.1-alpha`
    }
  })

  const branches = await api.listProjectBranches(projectId)
  if (branches.status !== 200) {
    throw new Error(`Failed to list branches for project ${projectId}`)
  }

  const childBranch = branches.data.branches.find(
    branch => branch.name === branchName
  )
  if (!childBranch) {
    throw new Error(`Branch ${branchName} not found in project ${projectId}`)
  }

  if (!childBranch.parent_id) {
    throw new Error(`Branch ${branchName} has no parent`)
  }

  const parentBranch = branches.data.branches.find(
    branch => branch.id === childBranch.parent_id
  )
  if (!parentBranch) {
    throw new Error(`Parent branch for ${branchName} not found`)
  }

  const childSchema = await api.getProjectBranchSchema({
    projectId,
    branchId: childBranch.id,
    role: username || 'neondb_owner',
    db_name: 'neondb'
  })
  if (childSchema.status !== 200) {
    throw new Error(
      `Failed to get schema for branch ${branchName} in project ${projectId}`
    )
  }

  const parentSchema = await api.getProjectBranchSchema({
    projectId,
    branchId: parentBranch.id,
    role: username || 'neondb_owner',
    db_name: 'neondb'
  })
  if (parentSchema.status !== 200) {
    throw new Error(
      `Failed to get schema for parent of ${branchName} in project ${projectId}`
    )
  }

  const diff = createPatch(
    `${database}-schema.sql`,
    parentSchema.data?.sql || '',
    childSchema.data?.sql || '',
    `Branch ${parentBranch.name}`,
    `Branch ${childBranch.name}`
  )

  return {
    sqlDiff: diff,
    parentBranch,
    childBranch,
    role: username || 'neondb_owner',
    database: database || 'neondb'
  }
}

export function diffSummary(diff: BranchDiff, projectId: string): string {
  const { parentBranch, childBranch, database, role } = diff

  return `
<!--- Schema diff between ${diff.parentBranch.name} and ${diff.childBranch.name} -->
<!--- Neon database schema diff GitHub action comment identifier -->

# 🧩 Neon schema diff summary

Schema diff between the branch ([${childBranch.name}](https://console.neon.tech)) and its parent ([${parentBranch.name}](https://console.neon.tech)). You can also checkout the [diff](https://console.neon.tech/app/projects/${projectId}/branches/${childBranch.id}#compare-to-parent) in the Neon console for more details.

- Parent branch: ${parentBranch.name} (${parentBranch.id}) ${parentBranch.protected ? '🔒' : ''}
- Current branch: ${childBranch.name} (${childBranch.id}) ${childBranch.protected ? '🔒' : ''}
- Database: ${database}
- Role: ${role}

\`\`\`diff
${diff.sqlDiff}
\`\`\`

This comment was last updated at ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}
`
}

export async function upsertGitHubComment(
  token: string,
  diff: string
): Promise<string> {
  const { context } = github

  const oktokit = github.getOctokit(token)

  // search the current pr for the comment
  const comments = await oktokit.rest.issues.listComments({
    ...context.repo,
    issue_number: context.issue.number
  })

  const comment = comments.data.find(comment =>
    comment.body?.includes(
      '<!--- Neon database schema diff GitHub action comment identifier -->'
    )
  )

  if (comment) {
    const updatedComment = await oktokit.rest.issues.updateComment({
      ...context.repo,
      comment_id: comment.id,
      body: diff
    })

    if (updatedComment.status !== 200) {
      throw new Error(`Failed to update comment ${comment.id}`)
    }

    return updatedComment.data.url
  }

  // create a new comment
  const createdComment = await oktokit.rest.issues.createComment({
    ...context.repo,
    issue_number: context.issue.number,
    body: diff
  })

  return createdComment.data.url
}
