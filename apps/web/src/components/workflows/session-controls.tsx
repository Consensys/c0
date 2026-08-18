import { Badge, type BadgeVariant } from "@cloudflare/kumo/components/badge"
import { InputArea } from "@cloudflare/kumo/components/input"
import {
  ArrowRightFromLine,
  ArrowRightToLine,
  Bot,
  Box,
  Braces,
  CalendarClock,
  ChevronRight,
  Code2,
  Database,
  FolderGit2,
  GitBranch,
  Globe2,
  KeyRound,
  ListChecks,
  ListPlus,
  ListVideo,
  type LucideIcon,
  Mail,
  MessageSquare,
  Play,
  Timer,
  UserCheck,
  Webhook,
  Wrench,
} from "lucide-react"
import { type DragEvent as ReactDragEvent, useMemo, useState } from "react"
import {
  getGitHubRepoTool,
  getWorkflowNodeDefinition,
  AI_SEARCH_SESSION_TOOL_KIND,
  MCPCF_SESSION_TOOL_KIND,
  normalizeAiSearchSourceId,
  normalizeOpenCodeMcpServers,
  normalizeSessionTools,
  type OpenCodeMcpServers,
  type SessionToolSpec,
  summarizeSessionTools,
  type WorkflowManifestNode,
  type WorkflowNodeCategory,
  type WorkflowNodeEditorIcon,
  type WorkflowNodeType,
} from "@c0-agent/shared"
import { HomeGitRepoDialog, HomeSessionToolsDialog } from "@/components/home-session-tools-dialog"
import { useGitHubRepos } from "@/hooks/use-github-repos"
import { recessedInputClassName } from "@/lib/recessed-field"
import { WorkflowNodeCatalogItem } from "./types"
import { FieldLabel } from "./node-fields"

export function SessionToolsDialogControls({
  value,
  customMcpServers,
  onChangeTools,
  onChangeToolsConfig,
  helpText,
}: {
  value: SessionToolSpec[]
  customMcpServers: OpenCodeMcpServers
  onChangeTools: (tools: SessionToolSpec[]) => void
  onChangeToolsConfig: (value: {
    tools: SessionToolSpec[]
    customMcpServers: OpenCodeMcpServers
  }) => void
  helpText?: string
}) {
  const [repoDialogOpen, setRepoDialogOpen] = useState(false)
  const [toolsDialogOpen, setToolsDialogOpen] = useState(false)
  const {
    repos,
    loadingRepos,
    repoLoadError,
    needsGitHubLink,
    githubAppInstallUrl,
    repoQuery,
    repoPagination,
    updateRepoQuery,
  } = useGitHubRepos()
  const selectedTools = useMemo(() => normalizeSessionTools(value), [value])
  const selectedRepo = getGitHubRepoTool(selectedTools)
  const repoSummary = selectedRepo
    ? `${selectedRepo.repoOwner}/${selectedRepo.repoName}`
    : loadingRepos
      ? "Loading repositories..."
      : "No repository"
  const toolsSummary = summarizeSessionTools(
    selectedTools.filter((tool) => tool.kind !== "github_repo"),
    { emptyLabel: "No tools selected", customMcpServers },
  )

  return (
    <div className="mt-3">
      <FieldLabel label="Tools" helpText={helpText} />
      <div className="mt-1 grid gap-2">
        <button
          type="button"
          onClick={() => setRepoDialogOpen(true)}
          className="flex min-h-10 w-full items-center justify-between gap-3 rounded-lg border border-kumo-hairline bg-kumo-tint px-2.5 py-2 text-left transition-[background-color,color,transform] hover:bg-kumo-tint active:scale-[0.96]"
        >
          <span className="flex min-w-0 items-center gap-2">
            <FolderGit2 className="h-4 w-4 flex-shrink-0 text-kumo-subtle" aria-hidden />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-kumo-default">Repos</span>
              <span className="block truncate text-xs text-kumo-subtle">{repoSummary}</span>
            </span>
          </span>
          <ChevronRight className="h-4 w-4 flex-shrink-0 text-kumo-subtle" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => setToolsDialogOpen(true)}
          className="flex min-h-10 w-full items-center justify-between gap-3 rounded-lg border border-kumo-hairline bg-kumo-tint px-2.5 py-2 text-left transition-[background-color,color,transform] hover:bg-kumo-tint active:scale-[0.96]"
        >
          <span className="flex min-w-0 items-center gap-2">
            <Wrench className="h-4 w-4 flex-shrink-0 text-kumo-subtle" aria-hidden />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-kumo-default">Tools</span>
              <span className="block truncate text-xs text-kumo-subtle">{toolsSummary}</span>
            </span>
          </span>
          <ChevronRight className="h-4 w-4 flex-shrink-0 text-kumo-subtle" aria-hidden />
        </button>
      </div>
      {repoLoadError ? (
        <div className="mt-1 text-xs text-kumo-subtle">
          Repositories unavailable: {repoLoadError}
        </div>
      ) : null}
      <HomeGitRepoDialog
        open={repoDialogOpen}
        onClose={() => setRepoDialogOpen(false)}
        repos={repos}
        repoQuery={repoQuery}
        repoPagination={repoPagination}
        loadingRepos={loadingRepos}
        needsGitHubLink={needsGitHubLink}
        githubAppInstallUrl={githubAppInstallUrl}
        selectedTools={selectedTools}
        onRepoQueryChange={updateRepoQuery}
        onSave={onChangeTools}
        saveLabel="Apply"
        error={repoLoadError ? `Repositories unavailable: ${repoLoadError}` : undefined}
      />
      <HomeSessionToolsDialog
        open={toolsDialogOpen}
        onClose={() => setToolsDialogOpen(false)}
        selectedTools={selectedTools}
        customMcpServers={customMcpServers}
        onSave={onChangeToolsConfig}
        saveLabel="Apply"
      />
    </div>
  )
}

export function getSessionNodeTools(value: unknown): SessionToolSpec[] {
  if (!Array.isArray(value)) {
    return []
  }

  let repoTool: Extract<SessionToolSpec, { kind: "github_repo" }> | null = null
  const docTools = new Map<string, Extract<SessionToolSpec, { kind: "ai_search" }>>()
  const mcpcfTools = new Map<string, Extract<SessionToolSpec, { kind: "mcpcf_server" }>>()
  let hasWorkflowBuilderTool = false

  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue
    }

    const tool = item as Record<string, unknown>
    if (tool.kind === "github_repo" && !repoTool) {
      const repoOwner = typeof tool.repoOwner === "string" ? tool.repoOwner.trim() : ""
      const repoName = typeof tool.repoName === "string" ? tool.repoName.trim() : ""
      if (repoOwner && repoName) {
        repoTool = { kind: "github_repo", repoOwner, repoName }
      }
      continue
    }

    if (tool.kind === AI_SEARCH_SESSION_TOOL_KIND) {
      const sourceId = typeof tool.sourceId === "string" ? tool.sourceId : ""
      try {
        const normalizedSourceId = normalizeAiSearchSourceId(sourceId)
        docTools.set(normalizedSourceId, {
          kind: AI_SEARCH_SESSION_TOOL_KIND,
          sourceId: normalizedSourceId,
        })
      } catch {
        // Ignore invalid persisted tool records; the runtime validator handles active edits.
      }
      continue
    }

    if (tool.kind === "workflow_builder") {
      hasWorkflowBuilderTool = true
      continue
    }

    if (tool.kind === MCPCF_SESSION_TOOL_KIND) {
      const serverId = typeof tool.serverId === "string" ? tool.serverId.trim() : ""
      if (serverId) {
        mcpcfTools.set(serverId, { kind: MCPCF_SESSION_TOOL_KIND, serverId })
      }
    }
  }

  return normalizeSessionTools([
    ...(repoTool ? [repoTool] : []),
    ...docTools.values(),
    ...mcpcfTools.values(),
    ...(hasWorkflowBuilderTool ? [{ kind: "workflow_builder" } as const] : []),
  ])
}

export function getSessionNodeCustomMcpServers(value: unknown): OpenCodeMcpServers {
  return value === undefined || value === null ? {} : normalizeOpenCodeMcpServers(value)
}

export function LabeledTextarea({
  label,
  value,
  onChange,
  onBlur,
  mono,
  compact = false,
  helpText,
  rows = 5,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  mono?: boolean
  compact?: boolean
  helpText?: string
  rows?: number
}) {
  return (
    <div className={compact ? "block" : "mt-3"}>
      <InputArea
        label={label}
        labelTooltip={helpText}
        size="sm"
        rows={rows}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        spellCheck={false}
        className={`resize-none ${recessedInputClassName(false)} ${mono ? "font-mono" : "text-sm!"}`}
      />
    </div>
  )
}

export function WorkflowNodeCatalogSubButton({
  item,
  dragged,
  onAddNode,
  onDragStart,
  onDragEnd,
  onPreview,
  onClearPreview,
}: {
  item: WorkflowNodeCatalogItem
  dragged: boolean
  onAddNode: (type: WorkflowNodeType, position?: WorkflowManifestNode["position"]) => void
  onDragStart: (event: ReactDragEvent<HTMLButtonElement>, item: WorkflowNodeCatalogItem) => void
  onDragEnd: () => void
  onPreview: (item: WorkflowNodeCatalogItem, element: HTMLElement) => void
  onClearPreview: () => void
}) {
  const disabled = Boolean(item.disabledReason)
  return (
    <button
      type="button"
      disabled={disabled}
      draggable={!disabled}
      onClick={() => onAddNode(item.definition.type)}
      onDragStart={(event) => {
        if (disabled) {
          event.preventDefault()
          return
        }
        onDragStart(event, item)
      }}
      onDragEnd={onDragEnd}
      onMouseEnter={(event) => onPreview(item, event.currentTarget)}
      onMouseLeave={onClearPreview}
      onFocus={(event) => onPreview(item, event.currentTarget)}
      onBlur={onClearPreview}
      aria-label={`${item.definition.label}. ${item.definition.description}`}
      title={item.disabledReason}
      className={`group/menu-button flex min-h-10 w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm text-kumo-default transition-[background-color,color,box-shadow] disabled:cursor-not-allowed disabled:text-kumo-subtle disabled:opacity-55 ${
        disabled
          ? ""
          : `cursor-grab active:cursor-grabbing ${getCategoryMenuSubButtonClassName(item.definition.category)}`
      } ${
        dragged && !disabled
          ? `${getCategoryMenuSubButtonDragClassName(item.definition.category)} text-kumo-default shadow-[inset_0_0_0_1px_rgb(56_189_248)]`
          : ""
      }`}
    >
      <WorkflowNodeCatalogOptionIcon
        type={item.definition.type}
        category={item.definition.category}
      />
      <span className="block min-w-0 truncate">{item.definition.label}</span>
    </button>
  )
}

export const WORKFLOW_NODE_ICON_COMPONENTS: Record<WorkflowNodeEditorIcon, LucideIcon> = {
  bot: Bot,
  box: Box,
  braces: Braces,
  "calendar-clock": CalendarClock,
  code: Code2,
  database: Database,
  "git-branch": GitBranch,
  globe: Globe2,
  key: KeyRound,
  mail: Mail,
  message: MessageSquare,
  play: Play,
  timer: Timer,
  "user-check": UserCheck,
  webhook: Webhook,
}

export const WORKFLOW_NODE_CATEGORY_ICONS: Record<WorkflowNodeCategory, LucideIcon> = {
  trigger: Play,
  logic: Code2,
  network: Globe2,
  session: Bot,
  slack: MessageSquare,
  notification: Mail,
  storage: Database,
}

export function NodeIcon({ type, className }: { type: WorkflowNodeType; className?: string }) {
  const Icon = WORKFLOW_NODE_ICON_COMPONENTS[getWorkflowNodeDefinition(type).editor.icon]
  return <Icon className={className} aria-hidden />
}

export function getWorkflowNodeCategoryIcon(category: WorkflowNodeCategory): LucideIcon {
  return WORKFLOW_NODE_CATEGORY_ICONS[category]
}

export function WorkflowNodeCatalogOptionIcon({
  type,
  category,
}: {
  type: WorkflowNodeType
  category: WorkflowNodeCategory
}) {
  return (
    <NodeCategoryIcon type={type} category={category} className="h-8 w-8" iconClassName="h-4 w-4" />
  )
}

export function NodeCategoryIcon({
  type,
  category,
  className,
  iconClassName = "h-3.5 w-3.5",
}: {
  type: WorkflowNodeType
  category: WorkflowNodeCategory
  className?: string
  iconClassName?: string
}) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-lg ${getCategoryIconSurfaceClassName(category)} ${className ?? "h-7 w-7"}`}
    >
      <NodeIcon type={type} className={iconClassName} />
    </span>
  )
}

export function getCategoryIconSurfaceClassName(category: WorkflowNodeCategory): string {
  return {
    trigger:
      "workflow-cat-icon-trigger group-hover/menu-button:bg-transparent group-focus-visible/menu-button:bg-transparent",
    logic:
      "workflow-cat-icon-logic group-hover/menu-button:bg-transparent group-focus-visible/menu-button:bg-transparent",
    network:
      "workflow-cat-icon-network group-hover/menu-button:bg-transparent group-focus-visible/menu-button:bg-transparent",
    session:
      "workflow-cat-icon-session group-hover/menu-button:bg-transparent group-focus-visible/menu-button:bg-transparent",
    slack:
      "workflow-cat-icon-slack group-hover/menu-button:bg-transparent group-focus-visible/menu-button:bg-transparent",
    notification:
      "workflow-cat-icon-notification group-hover/menu-button:bg-transparent group-focus-visible/menu-button:bg-transparent",
    storage:
      "workflow-cat-icon-storage group-hover/menu-button:bg-transparent group-focus-visible/menu-button:bg-transparent",
  }[category]
}

export function getCategoryMenuSubButtonClassName(category: WorkflowNodeCategory): string {
  return {
    trigger: "workflow-cat-hover-trigger",
    logic: "workflow-cat-hover-logic",
    network: "workflow-cat-hover-network",
    session: "workflow-cat-hover-session",
    slack: "workflow-cat-hover-slack",
    notification: "workflow-cat-hover-notification",
    storage: "workflow-cat-hover-storage",
  }[category]
}

export function getCategoryMenuSubButtonDragClassName(category: WorkflowNodeCategory): string {
  return {
    trigger: "workflow-cat-surface-trigger",
    logic: "workflow-cat-surface-logic",
    network: "workflow-cat-surface-network",
    session: "workflow-cat-surface-session",
    slack: "workflow-cat-surface-slack",
    notification: "workflow-cat-surface-notification",
    storage: "workflow-cat-surface-storage",
  }[category]
}

export function StatusBadge({ status }: { status: string }) {
  const variant: BadgeVariant =
    status === "completed" ? "success" : status === "failed" ? "error" : "warning"
  return (
    <Badge variant={variant} className="uppercase">
      {status}
    </Badge>
  )
}

export function RunEventStatusIcon({ eventType, level }: { eventType: string; level: string }) {
  const Icon =
    eventType === "run_queued"
      ? ListPlus
      : eventType === "run_started"
        ? ListVideo
        : eventType === "run_completed" || eventType === "run_complete"
          ? ListChecks
          : eventType === "node_started"
            ? ArrowRightFromLine
            : eventType === "node_completed"
              ? ArrowRightToLine
              : null
  if (!Icon) {
    return <StatusDot level={level} />
  }
  return (
    <Icon className={`h-3.5 w-3.5 ${getRunEventIconClassName(eventType, level)}`} aria-hidden />
  )
}

export function StatusDot({ level }: { level: string }) {
  return <span className={`h-2 w-2 rounded-full ${getStatusDotClassName(level)}`} />
}

export function getStatusDotClassName(level: string): string {
  const className =
    level === "error"
      ? "bg-kumo-danger-tint"
      : level === "warn"
        ? "bg-kumo-warning-tint"
        : "bg-kumo-success-tint"
  return className
}

export function getStatusIndicatorClassName(level: string): string {
  return level === "error"
    ? "text-kumo-danger"
    : level === "warn"
      ? "text-kumo-warning"
      : "text-kumo-success"
}

export function getRunEventIconClassName(eventType: string, level: string): string {
  if (level === "error" || level === "warn") {
    return getStatusIndicatorClassName(level)
  }
  if (eventType.startsWith("run_")) {
    return "text-kumo-brand"
  }
  return eventType.endsWith("_completed") ? "text-kumo-success" : "text-kumo-info"
}
