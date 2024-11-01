import * as core from '@actions/core'
import { diffSummary, schemaDiff, upsertGitHubComment } from './diff'

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    // Required fields
    const githubToken = core.getInput('github-token', { required: true })
    const projectId: string = core.getInput('project_id', { required: true })
    const branchName: string = core.getInput('branch_name', { required: true })
    const apiKey: string = core.getInput('api_key', { required: true })

    // Optional fields but with default value
    const apiHost: string = core.getInput('api_host')
    // can we also make the database optional?
    const database: string = core.getInput('database')

    // Optional fields without default value
    // make the username optional
    const username: string = core.getInput('username')

    // Debug logs are only output if the `ACTIONS_STEP_DEBUG` secret is true
    core.debug('Running schema-diff action')
    const diff = await schemaDiff(
      projectId,
      branchName,
      apiKey,
      apiHost,
      username,
      database
    )

    core.debug('Diff summary')
    const md = diffSummary(diff, projectId)

    // Set outputs for other workflow steps to use
    core.setOutput('schemadiff', diff.sqlDiff)

    core.debug('Creating a comment on the PR')
    // Create a comment on the PR with the diff summary
    const commentUrl = await upsertGitHubComment(githubToken, md)
    core.setOutput('comment_url', commentUrl)
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message)
  }
}
