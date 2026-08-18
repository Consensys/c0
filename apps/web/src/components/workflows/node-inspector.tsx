import { InputGroup } from "@cloudflare/kumo/components/input-group"
import { ChevronRight, Copy, Trash2 } from "lucide-react"
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  getNextWorkflowJsonObjectFieldName,
  getWorkflowJsonObjectFields,
  DEFAULT_SUBAGENT_MODE,
  type RuntimeModelCategory,
  validateWorkflowJsonObjectFieldName,
  WORKFLOW_KV_NAMESPACE_OPTIONS,
  WORKFLOW_R2_BUCKET_OPTIONS,
  WORKFLOW_STORAGE_ENCODING_OPTIONS,
  type WorkflowManifestNode,
  type WorkflowNodeDefinition,
} from "@c0-agent/shared"
import { ExpandableLayerCard } from "@/components/expandable-layer-card"
import { CodeSurface } from "@/components/code"
import { recessedInputGroupClassName } from "@/lib/recessed-field"
import {
  HTTP_ERROR_OPTIONS,
  HTTP_METHOD_OPTIONS,
  HTTP_RESPONSE_TYPE_OPTIONS,
  SLACK_TRIGGER_SURFACE_OPTIONS,
  WORKFLOW_SESSION_CACHE_TTL_OPTIONS,
  WorkflowCanvasEdge,
  WorkflowConfigFocusTarget,
  WorkflowHeaderDraftRow,
  WorkflowHeaderDraftRowErrors,
  WorkflowTemplateReferenceOption,
} from "./types"
import { WorkflowBuilderPanelTitleBar } from "./builder"
import { NodeInputsPanel, NodeOutputsPanel } from "./builder-canvas"
import { CelHelpModal } from "./modals"
import {
  FieldLabel,
  JsonObjectFieldsEditor,
  LabeledInput,
  LabeledNodeIdInput,
  LabeledSelect,
  SecretsDialogControls,
  TemplateInput,
  TemplateTextarea,
  WorkflowModelThinkingField,
  WorkflowHeadersEditor,
} from "./node-fields"
import {
  getSessionNodeCustomMcpServers,
  getSessionNodeTools,
  LabeledTextarea,
  NodeIcon,
  SessionToolsDialogControls,
} from "./session-controls"
import {
  getIfElseConditionExpression,
  getWorkflowSessionCacheTtlValue,
  hasWorkflowNodeInputConfigured,
  setManualInputValue,
} from "./manifest-utils"
import {
  getWorkflowHeaderDraftRowsValidation,
  parseWorkflowHeaderDraftRows,
  toDateTimeLocal,
} from "./header-utils"

export function NodeInspector({
  node,
  definition,
  connectedInputTemplates,
  edges,
  nodes,
  webhookUrl,
  modelOptions,
  providerCatalogLoading,
  isAdmin,
  nodeIds,
  configFocusTarget,
  headerDraftRows,
  onCopyWebhook,
  onHeaderDraftRowsChange,
  onChange,
  onConfigFocusComplete,
  onRename,
  onRenameInputHandle,
  onRemoveInputHandle,
  onRequestDelete,
  breadcrumb,
  panelAction,
}: {
  node: WorkflowManifestNode | null
  definition: WorkflowNodeDefinition | null
  connectedInputTemplates: WorkflowTemplateReferenceOption[]
  edges: WorkflowCanvasEdge[]
  nodes: WorkflowManifestNode[]
  webhookUrl: string
  modelOptions: RuntimeModelCategory[]
  providerCatalogLoading: boolean
  isAdmin: boolean
  nodeIds: string[]
  configFocusTarget: WorkflowConfigFocusTarget | null
  headerDraftRows: WorkflowHeaderDraftRow[] | null
  onCopyWebhook: () => void
  onHeaderDraftRowsChange: (nodeId: string, rows: WorkflowHeaderDraftRow[]) => void
  onChange: (updater: (node: WorkflowManifestNode) => WorkflowManifestNode) => void
  onConfigFocusComplete: () => void
  onRename: (nodeId: string) => boolean
  onRenameInputHandle: (previousHandle: string, nextHandle: string) => void
  onRemoveInputHandle: (handle: string) => void
  onRequestDelete: (node: WorkflowManifestNode) => void
  breadcrumb?: {
    label: string
    onNodesClick: () => void
  }
  panelAction?: ReactNode
}) {
  const [headerRows, setHeaderRows] = useState<WorkflowHeaderDraftRow[]>([])
  const [headersValidationError, setHeadersValidationError] = useState<string | null>(null)
  const [headerRowErrors, setHeaderRowErrors] = useState<WorkflowHeaderDraftRowErrors>({})
  const pendingHeadersCommitRef = useRef<{
    nodeId: string
    value: Record<string, string>
  } | null>(null)
  const headerDraftSequenceRef = useRef(0)
  const [celHelpOpen, setCelHelpOpen] = useState(false)
  const selectedModelId = typeof node?.options.model === "string" ? node.options.model : ""
  const selectedTools = useMemo(
    () => getSessionNodeTools(node?.options.tools),
    [node?.options.tools],
  )
  const customMcpServers = useMemo(
    () => getSessionNodeCustomMcpServers(node?.options.customMcpServers),
    [node?.options.customMcpServers],
  )
  const selectedSecretKeys = useMemo(
    () =>
      Array.isArray(node?.options.secretKeys)
        ? node.options.secretKeys.filter((key): key is string => typeof key === "string")
        : [],
    [node?.options.secretKeys],
  )
  const cacheKeyOption =
    typeof node?.options.cacheKey === "string" ? node.options.cacheKey.trim() : ""
  const cacheKeyInputConfigured = node
    ? hasWorkflowNodeInputConfigured(node, edges, "cacheKey")
    : false
  const cacheTtlEnabled = Boolean(cacheKeyOption || cacheKeyInputConfigured)
  const cacheTtlValue = getWorkflowSessionCacheTtlValue(node?.options.cacheTtlSeconds)

  const updateHeadersValidation = useCallback(
    (message: string | null, rowErrors: WorkflowHeaderDraftRowErrors = {}) => {
      setHeadersValidationError(message)
      setHeaderRowErrors(rowErrors)
    },
    [],
  )
  const createHeaderDraftRow = useCallback((key = "", value = ""): WorkflowHeaderDraftRow => {
    const id = `header-${headerDraftSequenceRef.current.toString(36)}`
    headerDraftSequenceRef.current += 1
    return { id, key, value }
  }, [])

  useEffect(() => {
    const pendingCommit = pendingHeadersCommitRef.current
    if (
      pendingCommit &&
      pendingCommit.nodeId === node?.id &&
      node?.options.headers === pendingCommit.value
    ) {
      pendingHeadersCommitRef.current = null
      return
    }
    pendingHeadersCommitRef.current = null
    const { rows, validation } = headerDraftRows
      ? { rows: headerDraftRows, validation: parseWorkflowHeaderDraftRows(headerDraftRows) }
      : getWorkflowHeaderDraftRowsValidation(node?.options.headers, createHeaderDraftRow)
    setHeaderRows(rows)
    if (validation.ok) {
      updateHeadersValidation(null, validation.rowErrors)
    } else {
      updateHeadersValidation(validation.message, validation.rowErrors)
    }
  }, [
    createHeaderDraftRow,
    headerDraftRows,
    node?.id,
    node?.options.headers,
    updateHeadersValidation,
  ])

  useEffect(() => {
    if (!node?.id || configFocusTarget?.nodeId !== node.id) {
      return
    }

    const animationFrameId = window.requestAnimationFrame(() => {
      const section = document.querySelector<HTMLElement>(
        `[data-workflow-config-section="${configFocusTarget.configLabel}"]`,
      )
      section?.scrollIntoView({ block: "center", behavior: "smooth" })
      const focusTarget =
        section?.querySelector<HTMLElement>('[aria-invalid="true"]') ??
        section?.querySelector<HTMLElement>("input, textarea, select, button")
      focusTarget?.focus()
      onConfigFocusComplete()
    })

    return () => window.cancelAnimationFrame(animationFrameId)
  }, [configFocusTarget, node?.id, onConfigFocusComplete])

  const updateOption = (key: string, value: unknown) => {
    onChange((current) => ({
      ...current,
      options: { ...current.options, [key]: value },
    }))
  }

  const updateOptions = (options: Record<string, unknown>) => {
    onChange((current) => ({
      ...current,
      options: { ...current.options, ...options },
    }))
  }

  const commitHeaderRows = (rows: WorkflowHeaderDraftRow[]): boolean => {
    const parsed = parseWorkflowHeaderDraftRows(rows)
    if (!parsed.ok) {
      updateHeadersValidation(parsed.message, parsed.rowErrors)
      return false
    }
    if (!node) {
      return false
    }

    updateHeadersValidation(null, parsed.rowErrors)
    pendingHeadersCommitRef.current = { nodeId: node.id, value: parsed.value }
    updateOption("headers", parsed.value)
    return true
  }

  const updateHeaderRows = (rows: WorkflowHeaderDraftRow[]) => {
    setHeaderRows(rows)
    if (node) {
      onHeaderDraftRowsChange(node.id, rows)
    }
    commitHeaderRows(rows)
  }

  if (!node || !definition) {
    return (
      <div className="flex h-full items-start justify-between gap-3 p-4 text-sm text-kumo-subtle">
        <span>Select a node to edit its options.</span>
        {panelAction}
      </div>
    )
  }

  const jsonObjectFields = getWorkflowJsonObjectFields(node)
  const addJsonObjectField = () => {
    const nextField = getNextWorkflowJsonObjectFieldName(jsonObjectFields)
    updateOption("fields", [...jsonObjectFields, nextField])
  }
  const renameJsonObjectField = (previousField: string, nextField: string): boolean => {
    const trimmedField = nextField.trim()
    if (
      !trimmedField ||
      !validateWorkflowJsonObjectFieldName(trimmedField) ||
      (trimmedField !== previousField && jsonObjectFields.includes(trimmedField))
    ) {
      return false
    }

    updateOption(
      "fields",
      jsonObjectFields.map((field) => (field === previousField ? trimmedField : field)),
    )
    onRenameInputHandle(previousField, trimmedField)
    return true
  }
  const removeJsonObjectField = (field: string) => {
    updateOption(
      "fields",
      jsonObjectFields.filter((item) => item !== field),
    )
    onRemoveInputHandle(field)
  }
  const updateManualInputValue = (handle: string, value: string) => {
    onChange((current) => setManualInputValue(current, handle, value))
  }
  const addHeaderRow = () => {
    updateHeaderRows([...headerRows, createHeaderDraftRow()])
  }
  const updateHeaderRow = (
    rowId: string,
    updates: Partial<Pick<WorkflowHeaderDraftRow, "key" | "value">>,
  ) => {
    updateHeaderRows(headerRows.map((row) => (row.id === rowId ? { ...row, ...updates } : row)))
  }
  const removeHeaderRow = (rowId: string) => {
    updateHeaderRows(headerRows.filter((row) => row.id !== rowId))
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {breadcrumb ? (
        <WorkflowBuilderPanelTitleBar action={panelAction}>
          <button
            type="button"
            onClick={breadcrumb.onNodesClick}
            className="font-medium text-kumo-subtle transition-colors hover:text-kumo-default"
          >
            Nodes
          </button>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-kumo-subtle" aria-hidden />
          <span className="min-w-0 truncate font-medium text-kumo-default">{breadcrumb.label}</span>
        </WorkflowBuilderPanelTitleBar>
      ) : null}
      <div className="transparent-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <NodeIcon type={node.type} className="h-4 w-4 flex-shrink-0 text-kumo-subtle" />
            <div className="min-w-0">
              <div className="text-sm font-medium text-kumo-default">{definition.label}</div>
              <div className="text-xs text-kumo-subtle">{definition.description}</div>
            </div>
          </div>
          {breadcrumb ? null : panelAction}
        </div>

        <div className="space-y-3">
          <ExpandableLayerCard title="Metadata">
            <LabeledNodeIdInput
              label="Node ID"
              value={node.id}
              existingIds={nodeIds}
              onCommit={onRename}
              helpText="Stable identifier used by edges, template references, and workflow run events. Renaming updates connected handles where possible."
            />
            <LabeledInput
              label="Label"
              value={node.label}
              onChange={(value) => onChange((current) => ({ ...current, label: value }))}
              helpText="Human-readable name shown on the canvas, inspector, and run history."
            />
            <NodeOutputsPanel definition={definition} />
          </ExpandableLayerCard>

          <ExpandableLayerCard title="Inputs">
            <NodeInputsPanel
              node={node}
              definition={definition}
              edges={edges}
              nodes={nodes}
              onChangeManualInput={updateManualInputValue}
              onDisconnectInput={onRemoveInputHandle}
            />
          </ExpandableLayerCard>

          {definition.editor.configuration !== "none" ? (
            <ExpandableLayerCard title="Configuration">
              {node.type === "manual-trigger" ? (
                <div className="text-xs text-kumo-subtle">No configuration</div>
              ) : null}

              {node.type === "webhook-trigger" ? (
                <div className="mt-3">
                  <InputGroup
                    size="sm"
                    label="Endpoint"
                    labelTooltip="URL that external systems call to start this workflow after it has been saved."
                    className={recessedInputGroupClassName}
                  >
                    <InputGroup.Input
                      value={webhookUrl || "Save the workflow to create an endpoint"}
                      readOnly
                      aria-label="Webhook endpoint"
                      className="text-xs text-kumo-subtle"
                    />
                    <InputGroup.Addon align="end">
                      <InputGroup.Button
                        shape="square"
                        icon={<Copy className="h-4 w-4" aria-hidden />}
                        aria-label="Copy webhook endpoint"
                        tooltip="Copy webhook endpoint"
                        disabled={!webhookUrl}
                        onClick={onCopyWebhook}
                      />
                    </InputGroup.Addon>
                  </InputGroup>
                </div>
              ) : null}

              {node.type === "datetime-trigger" ? (
                <LabeledInput
                  label="Scheduled At"
                  type="datetime-local"
                  value={toDateTimeLocal(node.options.scheduledAt)}
                  onChange={(value) =>
                    updateOption("scheduledAt", value ? new Date(value).toISOString() : "")
                  }
                  helpText="One-time wall-clock date and time when this workflow should start."
                />
              ) : null}

              {node.type === "cron-trigger" ? (
                <LabeledInput
                  label="Cron UTC"
                  value={String(node.options.cron ?? "")}
                  onChange={(value) => updateOption("cron", value)}
                  helpText="Cron expression evaluated in UTC for recurring workflow runs."
                />
              ) : null}

              {node.type === "slack-trigger" ? (
                <>
                  <LabeledSelect
                    label="Surface"
                    value={String(node.options.surface ?? "event")}
                    onChange={(value) => updateOption("surface", value)}
                    options={SLACK_TRIGGER_SURFACE_OPTIONS}
                    helpText="Slack request surface routed into this trigger node."
                  />
                  <LabeledInput
                    label="Event Types"
                    value={
                      Array.isArray(node.options.eventTypes)
                        ? node.options.eventTypes.join(", ")
                        : ""
                    }
                    onChange={(value) =>
                      updateOption(
                        "eventTypes",
                        value
                          .split(",")
                          .map((item) => item.trim())
                          .filter(Boolean),
                      )
                    }
                    helpText="Comma-separated Events API event types such as app_mention, message, or channel_created."
                  />
                  <LabeledInput
                    label="Channel Pattern"
                    value={String(node.options.channelNamePattern ?? "")}
                    onChange={(value) => updateOption("channelNamePattern", value)}
                    helpText="Optional regular expression matched against the Slack channel name."
                  />
                  <LabeledInput
                    label="Keywords"
                    value={
                      Array.isArray(node.options.keywordRules)
                        ? node.options.keywordRules.join(", ")
                        : ""
                    }
                    onChange={(value) =>
                      updateOption(
                        "keywordRules",
                        value
                          .split(",")
                          .map((item) => item.trim())
                          .filter(Boolean),
                      )
                    }
                    helpText="Optional comma-separated terms that must appear in the Slack text."
                  />
                  <LabeledInput
                    label="Command"
                    value={String(node.options.command ?? "")}
                    onChange={(value) => updateOption("command", value)}
                    helpText="Slash command name for command triggers, for example /c0."
                  />
                  <LabeledInput
                    label="Action IDs"
                    value={
                      Array.isArray(node.options.actionIds) ? node.options.actionIds.join(", ") : ""
                    }
                    onChange={(value) =>
                      updateOption(
                        "actionIds",
                        value
                          .split(",")
                          .map((item) => item.trim())
                          .filter(Boolean),
                      )
                    }
                    helpText="Optional comma-separated Slack Block Kit action ids for interaction triggers."
                  />
                  <LabeledInput
                    label="Cooldown Seconds"
                    value={String(node.options.cooldownSeconds ?? 0)}
                    onChange={(value) => updateOption("cooldownSeconds", value ? Number(value) : 0)}
                    helpText="Minimum time before this trigger node can start another run."
                  />
                  <LabeledInput
                    label="Dedupe Window Seconds"
                    value={String(node.options.dedupeWindowSeconds ?? 300)}
                    onChange={(value) =>
                      updateOption("dedupeWindowSeconds", value ? Number(value) : 300)
                    }
                    helpText="Slack retry/idempotency window retained by the workflow router."
                  />
                </>
              ) : null}

              {node.type === "javascript" ? (
                <div className="mt-3">
                  <FieldLabel
                    label="Code"
                    helpText="JavaScript executed inside the workflow. Use inputs to compute the node result."
                  />
                  <CodeSurface
                    title={`${node.label || definition.label} code`}
                    value={String(node.options.code ?? "")}
                    language="javascript"
                    mode="editable"
                    onSave={(value) => updateOption("code", value)}
                  />
                </div>
              ) : null}

              {node.type === "if-else" ? (
                <div className="mt-3">
                  <FieldLabel
                    label="If"
                    helpText="Common Expression Language condition. Truthy results follow the true branch; falsey results follow the false branch."
                  />
                  <CodeSurface
                    title={`${node.label || definition.label} condition`}
                    value={getIfElseConditionExpression(node)}
                    language="text"
                    mode="editable"
                    onSave={(value) => updateOption("conditionExpression", value)}
                    previewMaxHeightClassName="max-h-32"
                  />
                  <p className="mt-2 text-xs leading-5 text-kumo-subtle">
                    Use Common Expression Language to create a custom expression.{" "}
                    <button
                      type="button"
                      onClick={() => setCelHelpOpen(true)}
                      className="underline underline-offset-2 transition hover:text-kumo-default"
                    >
                      Learn more.
                    </button>
                  </p>
                </div>
              ) : null}

              {node.type === "json-object" ? (
                <JsonObjectFieldsEditor
                  fields={jsonObjectFields}
                  onAdd={addJsonObjectField}
                  onRename={renameJsonObjectField}
                  onRemove={removeJsonObjectField}
                  helpText="Output property names created by this node. Each field becomes an input handle and output key."
                />
              ) : null}

              {node.type === "user-approval" ? (
                <>
                  <TemplateTextarea
                    label="Message"
                    value={String(node.options.message ?? "")}
                    onChange={(value) => updateOption("message", value)}
                    templateOptions={connectedInputTemplates}
                    helpText="Approval request shown to the reviewer. Supports workflow input references."
                  />
                  <LabeledInput
                    label="Timeout"
                    value={String(node.options.timeout ?? "")}
                    onChange={(value) => updateOption("timeout", value)}
                    helpText="How long to wait for a decision before the approval expires."
                  />
                </>
              ) : null}

              {node.type === "sleep" ? (
                <LabeledInput
                  label="Duration"
                  value={String(node.options.duration ?? "")}
                  onChange={(value) => updateOption("duration", value)}
                  helpText="How long to pause before continuing, such as 30 seconds, 5 minutes, or 1 day. The workflow does not consume compute while sleeping."
                />
              ) : null}

              {node.type === "http-request" ? (
                <>
                  <LabeledSelect
                    label="Method"
                    value={String(node.options.method ?? "GET")}
                    onChange={(value) => updateOption("method", value)}
                    options={HTTP_METHOD_OPTIONS}
                    helpText="HTTP method used for the outbound request."
                  />
                  <TemplateInput
                    label="URL"
                    value={String(node.options.url ?? "")}
                    onChange={(value) => updateOption("url", value)}
                    templateOptions={connectedInputTemplates}
                    helpText="Destination URL to call. Supports workflow input references."
                  />
                  <WorkflowHeadersEditor
                    rows={headerRows}
                    onAdd={addHeaderRow}
                    onChangeRow={updateHeaderRow}
                    onRemove={removeHeaderRow}
                    errorText={headersValidationError}
                    rowErrors={headerRowErrors}
                    templateOptions={connectedInputTemplates}
                    helpText="HTTP headers to send with the request. Values support workflow input references."
                  />
                  <TemplateTextarea
                    label="Body"
                    value={String(node.options.body ?? "")}
                    onChange={(value) => updateOption("body", value)}
                    mono
                    templateOptions={connectedInputTemplates}
                    helpText="Request body sent to the endpoint. Supports workflow input references."
                  />
                  <LabeledSelect
                    label="Response Type"
                    value={String(node.options.responseType ?? "auto")}
                    onChange={(value) => updateOption("responseType", value)}
                    options={HTTP_RESPONSE_TYPE_OPTIONS}
                    helpText="How to parse the response body for downstream outputs."
                  />
                  <LabeledSelect
                    label="HTTP Errors"
                    value={String(node.options.failOnHttpError ?? false)}
                    onChange={(value) => updateOption("failOnHttpError", value === "true")}
                    options={HTTP_ERROR_OPTIONS}
                    helpText="Choose whether 4xx and 5xx responses should fail the node."
                  />
                  <LabeledInput
                    label="Timeout MS"
                    value={String(node.options.timeoutMs ?? "")}
                    onChange={(value) => updateOption("timeoutMs", value ? Number(value) : "")}
                    helpText="Maximum time to wait for the HTTP request before failing the node."
                  />
                </>
              ) : null}

              {node.type === "slack-send-message" ? (
                <>
                  <TemplateInput
                    label="Channel"
                    value={String(node.options.channel ?? "")}
                    onChange={(value) => updateOption("channel", value)}
                    templateOptions={connectedInputTemplates}
                    helpText="Slack channel ID or name. Defaults to the workflow Slack app bot token."
                  />
                  <TemplateTextarea
                    label="Text"
                    value={String(node.options.text ?? "")}
                    onChange={(value) => updateOption("text", value)}
                    templateOptions={connectedInputTemplates}
                    helpText="Slack message text. Supports workflow input references."
                  />
                  <TemplateInput
                    label="Thread TS"
                    value={String(node.options.threadTs ?? "")}
                    onChange={(value) => updateOption("threadTs", value)}
                    templateOptions={connectedInputTemplates}
                    helpText="Optional Slack thread timestamp for threaded replies."
                  />
                </>
              ) : null}

              {node.type === "slack-join-channel" ? (
                <TemplateInput
                  label="Channel"
                  value={String(node.options.channel ?? "")}
                  onChange={(value) => updateOption("channel", value)}
                  templateOptions={connectedInputTemplates}
                  helpText="Slack channel ID or name for the workflow Slack app to join."
                />
              ) : null}

              {node.type === "slack-fetch-thread" ? (
                <>
                  <TemplateInput
                    label="Channel"
                    value={String(node.options.channel ?? "")}
                    onChange={(value) => updateOption("channel", value)}
                    templateOptions={connectedInputTemplates}
                    helpText="Slack channel ID or name containing the thread."
                  />
                  <TemplateInput
                    label="Thread TS"
                    value={String(node.options.threadTs ?? "")}
                    onChange={(value) => updateOption("threadTs", value)}
                    templateOptions={connectedInputTemplates}
                    helpText="Slack thread timestamp to fetch."
                  />
                  <LabeledInput
                    label="Limit"
                    value={String(node.options.limit ?? 20)}
                    onChange={(value) => updateOption("limit", value ? Number(value) : 20)}
                    helpText="Maximum number of thread messages to read."
                  />
                </>
              ) : null}

              {node.type === "slack-add-reaction" || node.type === "slack-remove-reaction" ? (
                <>
                  <TemplateInput
                    label="Channel"
                    value={String(node.options.channel ?? "")}
                    onChange={(value) => updateOption("channel", value)}
                    templateOptions={connectedInputTemplates}
                    helpText="Slack channel ID containing the message."
                  />
                  <TemplateInput
                    label="Timestamp"
                    value={String(node.options.timestamp ?? "")}
                    onChange={(value) => updateOption("timestamp", value)}
                    templateOptions={connectedInputTemplates}
                    helpText={
                      node.type === "slack-remove-reaction"
                        ? "Slack message timestamp to remove the reaction from."
                        : "Slack message timestamp to react to."
                    }
                  />
                  <TemplateInput
                    label="Reaction"
                    value={String(node.options.name ?? "")}
                    onChange={(value) => updateOption("name", value)}
                    templateOptions={connectedInputTemplates}
                    helpText="Reaction name without surrounding colons."
                  />
                </>
              ) : null}

              {node.type === "email-notification" ? (
                <>
                  <TemplateInput
                    label="To"
                    value={String(node.options.to ?? "")}
                    onChange={(value) => updateOption("to", value)}
                    templateOptions={connectedInputTemplates}
                    helpText="Recipient email address. Supports workflow input references."
                  />
                  <TemplateInput
                    label="From"
                    value={String(node.options.from ?? "")}
                    onChange={(value) => updateOption("from", value)}
                    templateOptions={connectedInputTemplates}
                    helpText="Sender address used by the email provider."
                  />
                  <TemplateInput
                    label="Subject"
                    value={String(node.options.subject ?? "")}
                    onChange={(value) => updateOption("subject", value)}
                    templateOptions={connectedInputTemplates}
                    helpText="Email subject line. Supports workflow input references."
                  />
                  <TemplateTextarea
                    label="Body"
                    value={String(node.options.body ?? "")}
                    onChange={(value) => updateOption("body", value)}
                    templateOptions={connectedInputTemplates}
                    helpText="Email body. Supports workflow input references."
                  />
                </>
              ) : null}

              {node.type === "isolate-session" || node.type === "sandbox-session" ? (
                <>
                  <WorkflowModelThinkingField
                    modelValue={selectedModelId}
                    reasoningEffort={String(node.options.reasoningEffort ?? "")}
                    modelOptions={modelOptions}
                    loading={providerCatalogLoading}
                    isAdmin={isAdmin}
                    onModelChange={(value, reasoningEffort) =>
                      updateOptions({ model: value, reasoningEffort })
                    }
                    onReasoningChange={(value) => updateOption("reasoningEffort", value)}
                    helpText="Model and reasoning budget used by this agent node when it runs."
                  />
                  <LabeledTextarea
                    label="Prompt"
                    value={String(node.options.prompt ?? "")}
                    onChange={(value) => updateOption("prompt", value)}
                    mono
                    helpText="Instruction sent to the agent. If the context input is connected, that value is used as the prompt content."
                  />
                  <TemplateInput
                    label="Session key"
                    value={String(node.options.sessionKey ?? "")}
                    onChange={(value) => updateOption("sessionKey", value)}
                    templateOptions={connectedInputTemplates}
                    helpText="Reuse the same agent session when this node runs again with the same key. Use a stable value when follow-up runs should keep prior session context."
                  />
                  <TemplateInput
                    label="Cache key"
                    value={String(node.options.cacheKey ?? "")}
                    onChange={(value) => updateOption("cacheKey", value)}
                    templateOptions={connectedInputTemplates}
                    helpText="Cache completed agent responses for matching keys. Use it to skip rerunning the agent for repeated inputs until the selected cache TTL expires."
                  />
                  <LabeledSelect
                    label="Cache TTL"
                    value={cacheTtlValue}
                    onChange={(value) =>
                      updateOption("cacheTtlSeconds", value ? Number(value) : "")
                    }
                    disabled={!cacheTtlEnabled}
                    options={[
                      {
                        value: "",
                        label: cacheTtlEnabled ? "Select TTL" : "Set a cache key first",
                      },
                      ...WORKFLOW_SESSION_CACHE_TTL_OPTIONS,
                    ]}
                    helpText="How long a completed response stays reusable for matching cache keys."
                  />
                  <LabeledSelect
                    label="Incognito"
                    value={node.options.incognito === false ? "false" : "true"}
                    onChange={(value) => updateOption("incognito", value === "true")}
                    options={[
                      { value: "true", label: "Enabled" },
                      { value: "false", label: "Disabled" },
                    ]}
                    helpText="Keeps workflow-created sessions out of the normal chat session list."
                  />
                  {node.type === "isolate-session" ? (
                    <LabeledSelect
                      label="Sub-agents"
                      value={String(node.options.subagents ?? DEFAULT_SUBAGENT_MODE)}
                      onChange={(value) => updateOption("subagents", value)}
                      options={[
                        { value: "enabled", label: "Enabled" },
                        { value: "disabled", label: "Disabled" },
                      ]}
                      helpText="Lets this agent delegate independent work to isolated child agents and incorporate their results."
                    />
                  ) : null}
                  <SessionToolsDialogControls
                    value={selectedTools}
                    customMcpServers={customMcpServers}
                    onChangeTools={(tools) => updateOption("tools", tools)}
                    onChangeToolsConfig={({ tools, customMcpServers }) => {
                      updateOptions({ tools, customMcpServers })
                    }}
                    helpText="Choose the GitHub repository, knowledge sources, and custom MCP servers available to this agent node."
                  />
                  <SecretsDialogControls
                    selectedSecretKeys={selectedSecretKeys}
                    onChange={(keys) => updateOption("secretKeys", keys)}
                    helpText="Attached secrets are injected as environment variables for this agent node."
                  />
                </>
              ) : null}

              {node.type === "r2-put-object" || node.type === "r2-get-object" ? (
                <>
                  <LabeledSelect
                    label="Bucket"
                    value={String(node.options.bucket ?? "WORKFLOW_BUCKET")}
                    onChange={(value) => updateOption("bucket", value)}
                    options={WORKFLOW_R2_BUCKET_OPTIONS.map((bucket) => ({
                      value: bucket.binding,
                      label: bucket.label,
                    }))}
                    helpText="R2 bucket binding used by this storage node."
                  />
                  <TemplateInput
                    label="Object Key"
                    value={String(node.options.key ?? "")}
                    onChange={(value) => updateOption("key", value)}
                    templateOptions={connectedInputTemplates}
                    helpText="R2 object key to read or write. Supports workflow input references."
                  />
                  {node.type === "r2-put-object" ? (
                    <>
                      <LabeledSelect
                        label="Encoding"
                        value={String(node.options.encoding ?? "text")}
                        onChange={(value) => updateOption("encoding", value)}
                        options={WORKFLOW_STORAGE_ENCODING_OPTIONS.map((encoding) => ({
                          value: encoding.value,
                          label: encoding.label,
                        }))}
                        helpText="Decode base64 content before writing binary objects like images."
                      />
                      <LabeledInput
                        label="Content Type"
                        value={String(node.options.contentType ?? "")}
                        onChange={(value) => updateOption("contentType", value)}
                        helpText="MIME type stored with the written R2 object."
                      />
                    </>
                  ) : (
                    <LabeledSelect
                      label="Response Type"
                      value={String(node.options.responseType ?? "auto")}
                      onChange={(value) => updateOption("responseType", value)}
                      options={HTTP_RESPONSE_TYPE_OPTIONS}
                      helpText="How to parse the fetched R2 object body."
                    />
                  )}
                </>
              ) : null}

              {node.type === "kv-put" || node.type === "kv-get" ? (
                <>
                  <LabeledSelect
                    label="Namespace"
                    value={String(node.options.namespace ?? "USER_WORKFLOW_KV")}
                    onChange={(value) => updateOption("namespace", value)}
                    options={WORKFLOW_KV_NAMESPACE_OPTIONS.map((namespace) => ({
                      value: namespace.binding,
                      label: namespace.label,
                    }))}
                    helpText="KV namespace binding used by this storage node."
                  />
                  <TemplateInput
                    label="Key"
                    value={String(node.options.key ?? "")}
                    onChange={(value) => updateOption("key", value)}
                    templateOptions={connectedInputTemplates}
                    helpText="KV key to read or write. Supports workflow input references."
                  />
                  {node.type === "kv-put" ? (
                    <LabeledInput
                      label="Expiration TTL Seconds"
                      value={String(node.options.expirationTtl ?? "")}
                      onChange={(value) =>
                        updateOption("expirationTtl", value ? Number(value) : "")
                      }
                      helpText="Optional number of seconds before the KV value expires."
                    />
                  ) : (
                    <LabeledSelect
                      label="Response Type"
                      value={String(node.options.responseType ?? "auto")}
                      onChange={(value) => updateOption("responseType", value)}
                      options={HTTP_RESPONSE_TYPE_OPTIONS}
                      helpText="How to parse the fetched KV value."
                    />
                  )}
                </>
              ) : null}
            </ExpandableLayerCard>
          ) : null}
        </div>
      </div>
      {celHelpOpen ? <CelHelpModal onClose={() => setCelHelpOpen(false)} /> : null}
      <div className="space-y-2 border-t border-kumo-hairline p-4">
        <button
          type="button"
          onClick={() => onRequestDelete(node)}
          className="kumo-btn-destructive"
        >
          <Trash2 className="h-4 w-4" aria-hidden />
          Delete node
        </button>
      </div>
    </div>
  )
}
