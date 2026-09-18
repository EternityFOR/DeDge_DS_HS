import type { SessionSummary } from '../gateway/protocol.js'
import { normalizeWorkspaceIdentity } from '../runtime/gateway-lease.js'

/**
 * Whether one listed Harness session belongs to the workspace bound to the
 * current runtime. Sessions without a recorded cwd are kept visible because a
 * freshly created blank session may not have projected it yet.
 */
export function sessionBelongsToWorkspace(
  session: { readonly cwd?: string | undefined },
  workspace: string,
): boolean {
  if (session.cwd === undefined || session.cwd.trim() === '') return true
  return normalizeWorkspaceIdentity(session.cwd) === normalizeWorkspaceIdentity(workspace)
}

/** Keep only the sessions that can be served by the current workspace runtime. */
export function filterWorkspaceSessions(
  sessions: readonly SessionSummary[],
  workspace: string,
): SessionSummary[] {
  return sessions.filter(session => sessionBelongsToWorkspace(session, workspace))
}