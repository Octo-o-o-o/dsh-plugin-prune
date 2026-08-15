/**
 * Best-effort tool → plugin attribution.
 *
 * DeepSeek Harness exposes no first-class provenance for "which plugin
 * registered this tool", so attribution combines three sources:
 *   1. this static map of the shipped official tools (snapshot of the
 *      upstream tool catalog);
 *   2. stack-frame attribution for tools registered while this plugin is
 *      active (parsed from `node_modules/<package>/` frames);
 *   3. a small exact/prefix table for well-known third-party tools.
 * Everything else is reported as `UNKNOWN`.
 * @module dsh-plugin-prune/static-map
 */

export const UNKNOWN = '未知来源'

/** Shipped official tools, from the upstream tool catalog snapshot. */
export const STATIC_MAP: Readonly<Record<string, string>> = {
  ask_user_question: '@deepseek-ai/dsh-tool-ask-user',
  run_code: '@deepseek-ai/dsh-tools',
  exit_plan_mode: '@deepseek-ai/dsh-plan-mode',
  bash: '@deepseek-ai/dsh-tool-bash-persistent',
  pwsh: '@deepseek-ai/dsh-tool-pwsh',
  cordis_define: '@deepseek-ai/dsh-tool-cordis',
  cordis_inspect_list: '@deepseek-ai/dsh-tool-cordis',
  cordis_inspect_query: '@deepseek-ai/dsh-tool-cordis',
  cordis_inspect_self: '@deepseek-ai/dsh-tool-cordis',
  cordis_run: '@deepseek-ai/dsh-tool-cordis',
  cordis_stop: '@deepseek-ai/dsh-tool-cordis',
  cordis_undefine: '@deepseek-ai/dsh-tool-cordis',
  str_replace_editor: '@deepseek-ai/dsh-tool-str-replace-editor',
  edit: '@deepseek-ai/dsh-tool-fs',
  read: '@deepseek-ai/dsh-tool-fs',
  read_image: '@deepseek-ai/dsh-tool-fs',
  write: '@deepseek-ai/dsh-tool-fs',
  glob: '@deepseek-ai/dsh-tool-fs-search',
  grep: '@deepseek-ai/dsh-tool-fs-search',
  terminal_close: '@deepseek-ai/dsh-tool-terminal',
  terminal_list: '@deepseek-ai/dsh-tool-terminal',
  terminal_open: '@deepseek-ai/dsh-tool-terminal',
  terminal_read: '@deepseek-ai/dsh-tool-terminal',
  terminal_send: '@deepseek-ai/dsh-tool-terminal',
  terminal_signal: '@deepseek-ai/dsh-tool-terminal',
  create_goal: '@deepseek-ai/dsh-tool-goal',
  get_goal: '@deepseek-ai/dsh-tool-goal',
  update_goal: '@deepseek-ai/dsh-tool-goal',
  schedule_create: '@deepseek-ai/dsh-schedule',
  schedule_delete: '@deepseek-ai/dsh-schedule',
  schedule_list: '@deepseek-ai/dsh-schedule',
  lsp: '@deepseek-ai/dsh-tool-lsp',
  ralph: '@deepseek-ai/dsh-tool-ralph',
  skill: '@deepseek-ai/dsh-tool-skill',
  session_event_read: '@deepseek-ai/dsh-tool-session-query',
  session_event_search: '@deepseek-ai/dsh-tool-session-query',
  session_event_trace: '@deepseek-ai/dsh-tool-session-query',
  session_search: '@deepseek-ai/dsh-tool-session-query',
  session_trace: '@deepseek-ai/dsh-tool-session-query',
  subagent: '@deepseek-ai/dsh-tool-subagent',
  interrupt_agent: '@deepseek-ai/dsh-tool-subagent-control',
  list_agents: '@deepseek-ai/dsh-tool-subagent-control',
  send_message: '@deepseek-ai/dsh-tool-subagent-control',
  report: '@deepseek-ai/dsh-tool-subagent-report',
  job_kill: '@deepseek-ai/dsh-tool-jobs',
  job_list: '@deepseek-ai/dsh-tool-jobs',
  job_output: '@deepseek-ai/dsh-tool-jobs',
  todo_write: '@deepseek-ai/dsh-tool-todo',
  workflow: '@deepseek-ai/dsh-tool-workflow',
  web_fetch: '@deepseek-ai/dsh-tool-web',
  web_search: '@deepseek-ai/dsh-tool-web',
}

/** Exact names of well-known third-party tools. */
export const EXTRA_EXACT: Readonly<Record<string, string>> = {
  x_search: 'modsearch 桥接（第三方）',
  read_page: 'modsearch 桥接（第三方）',
}

/** Prefix table for third-party tool families. */
export const EXTRA_PREFIX: ReadonlyArray<readonly [string, string]> = [
  ['mnemon_', 'Mnemon 记忆集成（第三方）'],
  ['vision_', 'Vision Toolkit（第三方）'],
]

/** Resolve one tool name against the static tables. */
export function staticSource(name: string): string {
  const exact = STATIC_MAP[name]
  if (typeof exact === 'string' && exact !== '') return exact
  const extra = EXTRA_EXACT[name]
  if (typeof extra === 'string' && extra !== '') return extra
  for (const [prefix, label] of EXTRA_PREFIX) {
    if (name.startsWith(prefix)) return label
  }
  return UNKNOWN
}
