import { readFileSync, writeFileSync } from 'node:fs'

const ALPHA2_INJECT = 'const inject = [\n\t"agents",\n\t"sessions",\n\t"tools",\n\t"sessionPersistence"\n];'
const RC1_INJECT = 'const inject = [\n\t"agents",\n\t"sessions",\n\t"tools",\n\t"sessionPersistence"\n];'
const RC1_APPLY_MARKER = 'function apply(ctx) {\n\tctx.inject(["sessionProjections"], (projectionCtx) => {'

/**
 * Add the `/schedule-cancel` command to alpha.2's compiled schedule plugin.
 * @param {string} source - Compiled `@deepseek-ai/dsh-schedule` entry point.
 * @returns {string} Patched source.
 */
export function patchScheduleCancelCommandAlpha2Source(source) {
  return patchScheduleCancelSource(
    source,
    'alpha.2',
    ALPHA2_INJECT,
    'function apply(ctx) {\n\tctx.inject(["sessionProjections"], (projectionCtx) => {',
    { lengthText: 'active.length === 1 ? "Cancelled 1 scheduled reminder." : "Cancelled " + active.length + " scheduled reminders."' },
  )
}

/**
 * Add the `/schedule-cancel` command to the 0.1.5-rc.1 compiled schedule plugin.
 * Upstream RC.1 ships the three model tools but no direct cancellation command,
 * so the VS Code Pause button needs this bridge to release its scheduled work.
 * @param {string} source - Compiled `@deepseek-ai/dsh-schedule` entry point.
 * @returns {string} Patched source.
 */
export function patchScheduleCancelCommandRc1Source(source) {
  return patchScheduleCancelSource(
    source,
    '0.1.5-rc.1',
    RC1_INJECT,
    RC1_APPLY_MARKER,
    { lengthText: '"Cancelled " + active.length + " scheduled reminder" + (active.length === 1 ? "" : "s") + "."' },
  )
}

/**
 * Apply the source rewrite to a compiled plugin file.
 * @param {string} file - Absolute plugin entry point path.
 */
export function patchScheduleCancelCommandAlpha2(file) {
  writeFileSync(file, patchScheduleCancelCommandAlpha2Source(readFileSync(file, 'utf8')))
}

/**
 * Apply the source rewrite to a compiled plugin file.
 * @param {string} file - Absolute plugin entry point path.
 */
export function patchScheduleCancelCommandRc1(file) {
  writeFileSync(file, patchScheduleCancelCommandRc1Source(readFileSync(file, 'utf8')))
}

function patchScheduleCancelSource(source, label, injectMarker, applyMarker, options) {
  if (source.split(injectMarker).length !== 2) {
    throw new Error(`Unexpected ${label} schedule inject shape; cannot add the schedule-cancel command.`)
  }
  source = source.replace(
    injectMarker,
    'const inject = [\n\t"agents",\n\t"commands",\n\t"sessions",\n\t"tools",\n\t"sessionPersistence"\n];',
  )
  if (source.split(applyMarker).length !== 2) {
    throw new Error(`Unexpected ${label} schedule apply shape; cannot add the schedule-cancel command.`)
  }
  const registration = [
    'function apply(ctx) {',
    '\tctx.commands.register({',
    '\t\tname: "schedule-cancel",',
    '\t\tdescription: "Cancel one or all active scheduled reminders in this session",',
    '\t\tinput: { hint: "[<schedule-id>|all]" },',
    '\t\thandler: (invocation) => runScheduleTransaction(invocation.agent, async () => {',
    '\t\t\tconst target = invocation.rawInput.trim();',
    '\t\t\tlet folded;',
    '\t\t\ttry {',
    '\t\t\t\tfolded = foldScheduleEvents(invocation.agent.session.ownEvents());',
    '\t\t\t} catch {',
    '\t\t\t\treturn { kind: "error", text: "The session schedule log is corrupt; no reminder was cancelled." };',
    '\t\t\t}',
    '\t\t\tconst active = target === "" || target === "all" ? [...folded.active] : folded.active.filter((record) => record.id === target);',
    '\t\t\tif (target !== "" && target !== "all" && active.length === 0) return { kind: "error", text: "No active scheduled reminder matched " + JSON.stringify(target) + "." };',
    '\t\t\tif (active.length === 0) return { kind: "success", text: "No active scheduled reminders." };',
    '\t\t\tif (invocation.signal.aborted) return { kind: "error", text: "Scheduled reminder cancellation was interrupted." };',
    '\t\t\ttry {',
    '\t\t\t\tfor (const record of active) invocation.agent.session.append("schedule/change", { version: 1, operation: "delete", id: record.id });',
    '\t\t\t\tawait flushSchedulePersistence(ctx, invocation.agent.session);',
    '\t\t\t} catch {',
    '\t\t\t\treturn { kind: "error", text: "Scheduled reminders were not fully cancelled because the session could not be saved. Run schedule_list before retrying." };',
    '\t\t\t}',
    `\t\t\treturn { kind: "success", text: ${options.lengthText} };`,
    '\t\t})',
    '\t});',
    '\tctx.inject(["sessionProjections"], (projectionCtx) => {',
  ].join('\n')
  return source.replace(applyMarker, registration)
}