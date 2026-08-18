import { getDefaultSessionCustomMcpServers } from "../session-tools"
import { DEFAULT_SUBAGENT_MODE } from "../subagents"

export const WORKFLOW_NODE_TYPES = [
  "manual-trigger",
  "webhook-trigger",
  "datetime-trigger",
  "cron-trigger",
  "slack-trigger",
  "javascript",
  "if-else",
  "json-object",
  "user-approval",
  "sleep",
  "http-request",
  "isolate-session",
  "sandbox-session",
  "slack-send-message",
  "slack-join-channel",
  "slack-fetch-thread",
  "slack-add-reaction",
  "slack-remove-reaction",
  "email-notification",
  "r2-put-object",
  "r2-get-object",
  "kv-put",
  "kv-get",
  "get-secret",
] as const

export type WorkflowNodeType = (typeof WORKFLOW_NODE_TYPES)[number]
export type WorkflowTriggerNodeType = Extract<
  WorkflowNodeType,
  "manual-trigger" | "webhook-trigger" | "datetime-trigger" | "cron-trigger" | "slack-trigger"
>
export type WorkflowActionNodeType = Exclude<WorkflowNodeType, WorkflowTriggerNodeType>
export type WorkflowNodeCategory =
  | "trigger"
  | "logic"
  | "network"
  | "session"
  | "slack"
  | "notification"
  | "storage"
export type WorkflowNodeAdapterCategory = Exclude<WorkflowNodeCategory, "trigger" | "logic">
export type WorkflowNodeTriggerKind = "manual" | "webhook" | "datetime" | "cron" | "slack"
export type WorkflowNodeInlineExecutor =
  | "javascript"
  | "if-else"
  | "json-object"
  | "user-approval"
  | "sleep"
export type WorkflowNodeRuntimeSupport =
  | {
      kind: "trigger"
      triggerKind: WorkflowNodeTriggerKind
    }
  | {
      kind: "inline"
      executor: WorkflowNodeInlineExecutor
    }
  | {
      kind: "adapter"
      adapterCategory: WorkflowNodeAdapterCategory
    }

export type WorkflowNodeDefaultOptionsDefinition =
  | {
      strategy: "static"
      options: Record<string, unknown>
    }
  | {
      strategy: "relative-date"
      option: string
      offsetMs: number
    }

export type WorkflowNodeOptionValidationRule =
  | "isolate-subagents"
  | "json-object-fields"
  | "sleep-duration"
  | "storage-binding"
  | "storage-key-portability"

export interface WorkflowNodeValidationSupport {
  optionRules: readonly WorkflowNodeOptionValidationRule[]
  templateReferences: "connected-inputs"
}

export type WorkflowNodeEditorIcon =
  | "bot"
  | "box"
  | "braces"
  | "calendar-clock"
  | "code"
  | "database"
  | "git-branch"
  | "globe"
  | "key"
  | "mail"
  | "message"
  | "play"
  | "timer"
  | "user-check"
  | "webhook"

export type WorkflowNodeEditorConfiguration =
  | "none"
  | "empty"
  | "webhook-endpoint"
  | "datetime-schedule"
  | "cron-schedule"
  | "slack-trigger"
  | "javascript-code"
  | "if-condition"
  | "json-object-fields"
  | "user-approval"
  | "sleep-duration"
  | "http-request"
  | "notification"
  | "slack-action"
  | "session"
  | "r2-object"
  | "kv-entry"

export interface WorkflowNodeEditorSupport {
  icon: WorkflowNodeEditorIcon
  configuration: WorkflowNodeEditorConfiguration
}

export interface WorkflowPortDefinition {
  id: string
  type: "any" | "string" | "object" | "datetime" | "boolean"
  description?: string
}

export interface WorkflowNodeDefinition {
  type: WorkflowNodeType
  label: string
  description: string
  category: WorkflowNodeCategory
  inputs: WorkflowPortDefinition[]
  outputs: WorkflowPortDefinition[]
  defaults: WorkflowNodeDefaultOptionsDefinition
  validation: WorkflowNodeValidationSupport
  runtime: WorkflowNodeRuntimeSupport
  editor: WorkflowNodeEditorSupport
}

export const WORKFLOW_R2_BUCKET_OPTIONS = [
  {
    binding: "WORKFLOW_BUCKET",
    label: "Workflow artifacts",
    description: "Stores workflow manifests, generated code, and run artifacts.",
  },
  {
    binding: "AI_SEARCH_CONTENT_BUCKET",
    label: "AI Search content",
    description: "Stores documents that can be indexed by configured AI Search sources.",
  },
] as const

export type WorkflowR2BucketBinding = (typeof WORKFLOW_R2_BUCKET_OPTIONS)[number]["binding"]

export const WORKFLOW_STORAGE_ENCODING_OPTIONS = [
  { value: "text", label: "Text" },
  { value: "base64", label: "Base64" },
] as const

export type WorkflowStorageEncoding = (typeof WORKFLOW_STORAGE_ENCODING_OPTIONS)[number]["value"]

export const WORKFLOW_KV_NAMESPACE_OPTIONS = [
  {
    binding: "USER_WORKFLOW_KV",
    label: "User workflow KV",
    description: "Stores user-namespaced workflow data written by KV workflow nodes.",
  },
  {
    binding: "REPOS_CACHE",
    label: "Repos cache",
    description: "Legacy internal cache namespace. Existing imported workflows may reference it.",
  },
] as const

export type WorkflowKvNamespaceBinding = (typeof WORKFLOW_KV_NAMESPACE_OPTIONS)[number]["binding"]

const ONE_HOUR_MS = 60 * 60 * 1000
const NO_OPTION_VALIDATION_RULES = [] as const
const STORAGE_OPTION_VALIDATION_RULES = ["storage-binding", "storage-key-portability"] as const

const workflowNodeBaseValidation = {
  optionRules: NO_OPTION_VALIDATION_RULES,
  templateReferences: "connected-inputs",
} as const satisfies WorkflowNodeValidationSupport

const workflowIsolateSessionNodeValidation = {
  optionRules: ["isolate-subagents"],
  templateReferences: "connected-inputs",
} as const satisfies WorkflowNodeValidationSupport

const workflowStorageNodeValidation = {
  optionRules: STORAGE_OPTION_VALIDATION_RULES,
  templateReferences: "connected-inputs",
} as const satisfies WorkflowNodeValidationSupport

const workflowJsonObjectNodeValidation = {
  optionRules: ["json-object-fields"],
  templateReferences: "connected-inputs",
} as const satisfies WorkflowNodeValidationSupport

const workflowSleepNodeValidation = {
  optionRules: ["sleep-duration"],
  templateReferences: "connected-inputs",
} as const satisfies WorkflowNodeValidationSupport

const emptyWorkflowNodeDefaults = {
  strategy: "static",
  options: {},
} as const satisfies WorkflowNodeDefaultOptionsDefinition

export const WORKFLOW_NODE_CATALOG = [
  {
    type: "manual-trigger",
    label: "Manual",
    description: "Run this workflow manually.",
    category: "trigger",
    inputs: [],
    outputs: [{ id: "payload", type: "object" }],
    defaults: emptyWorkflowNodeDefaults,
    validation: workflowNodeBaseValidation,
    runtime: { kind: "trigger", triggerKind: "manual" },
    editor: { icon: "play", configuration: "empty" },
  },
  {
    type: "webhook-trigger",
    label: "Webhook",
    description: "Start a workflow from an HTTP webhook endpoint.",
    category: "trigger",
    inputs: [],
    outputs: [
      { id: "body", type: "object" },
      { id: "headers", type: "object" },
      { id: "query", type: "object" },
    ],
    defaults: emptyWorkflowNodeDefaults,
    validation: workflowNodeBaseValidation,
    runtime: { kind: "trigger", triggerKind: "webhook" },
    editor: { icon: "webhook", configuration: "webhook-endpoint" },
  },
  {
    type: "datetime-trigger",
    label: "Date Time",
    description: "Start a workflow at a specific date and time.",
    category: "trigger",
    inputs: [],
    outputs: [
      { id: "scheduledAt", type: "datetime" },
      { id: "firedAt", type: "datetime" },
    ],
    defaults: { strategy: "relative-date", option: "scheduledAt", offsetMs: ONE_HOUR_MS },
    validation: workflowNodeBaseValidation,
    runtime: { kind: "trigger", triggerKind: "datetime" },
    editor: { icon: "calendar-clock", configuration: "datetime-schedule" },
  },
  {
    type: "cron-trigger",
    label: "Cron",
    description: "Start a workflow on a recurring UTC cron schedule.",
    category: "trigger",
    inputs: [],
    outputs: [
      { id: "cron", type: "string" },
      { id: "scheduledAt", type: "datetime" },
      { id: "firedAt", type: "datetime" },
    ],
    defaults: { strategy: "static", options: { cron: "0 * * * *" } },
    validation: workflowNodeBaseValidation,
    runtime: { kind: "trigger", triggerKind: "cron" },
    editor: { icon: "calendar-clock", configuration: "cron-schedule" },
  },
  {
    type: "slack-trigger",
    label: "Slack",
    description: "Start a workflow from a workflow-hosted Slack app request.",
    category: "trigger",
    inputs: [],
    outputs: [
      { id: "teamId", type: "string" },
      { id: "channelId", type: "string" },
      { id: "channelName", type: "string" },
      { id: "userId", type: "string" },
      { id: "text", type: "string" },
      { id: "eventType", type: "string" },
      { id: "command", type: "string" },
      { id: "messageTs", type: "string" },
      { id: "threadTs", type: "string" },
      { id: "triggerId", type: "string" },
      { id: "actionId", type: "string" },
      { id: "responseUrl", type: "string" },
      { id: "rawPayload", type: "object" },
    ],
    defaults: {
      strategy: "static",
      options: {
        surface: "event",
        eventTypes: ["app_mention", "message"],
        channelNamePattern: "",
        keywordRules: [],
        cooldownSeconds: 0,
        dedupeWindowSeconds: 300,
        command: "/c0",
        commandDescription: "Ask c0",
        actionIds: [],
      },
    },
    validation: workflowNodeBaseValidation,
    runtime: { kind: "trigger", triggerKind: "slack" },
    editor: { icon: "message", configuration: "slack-trigger" },
  },
  {
    type: "javascript",
    label: "JavaScript",
    description: "Run arbitrary javascript",
    category: "logic",
    inputs: [{ id: "payload", type: "any" }],
    outputs: [{ id: "result", type: "any" }],
    defaults: { strategy: "static", options: { code: "return inputs.payload ?? null" } },
    validation: workflowNodeBaseValidation,
    runtime: { kind: "inline", executor: "javascript" },
    editor: { icon: "code", configuration: "javascript-code" },
  },
  {
    type: "if-else",
    label: "If / Else",
    description: "Create conditions to branch your workflow.",
    category: "logic",
    inputs: [{ id: "value", type: "any" }],
    outputs: [
      { id: "true", type: "any" },
      { id: "false", type: "any" },
      { id: "condition", type: "boolean" },
    ],
    defaults: { strategy: "static", options: { conditionExpression: "input != null" } },
    validation: workflowNodeBaseValidation,
    runtime: { kind: "inline", executor: "if-else" },
    editor: { icon: "git-branch", configuration: "if-condition" },
  },
  {
    type: "json-object",
    label: "JSON Object",
    description: "Combine connected values into one JSON object.",
    category: "logic",
    inputs: [{ id: "value", type: "any" }],
    outputs: [{ id: "object", type: "object" }],
    defaults: { strategy: "static", options: { fields: ["value", "value2"] } },
    validation: workflowJsonObjectNodeValidation,
    runtime: { kind: "inline", executor: "json-object" },
    editor: { icon: "braces", configuration: "json-object-fields" },
  },
  {
    type: "user-approval",
    label: "User Approval",
    description: "Pause until this workflow run is approved or rejected.",
    category: "logic",
    inputs: [{ id: "context", type: "any" }],
    outputs: [
      { id: "approved", type: "boolean" },
      { id: "decision", type: "string" },
      { id: "comment", type: "string" },
      { id: "approvedBy", type: "string" },
      { id: "approvedAt", type: "datetime" },
      { id: "payload", type: "object" },
    ],
    defaults: {
      strategy: "static",
      options: { message: "Approve this workflow run.", timeout: "7 days" },
    },
    validation: workflowNodeBaseValidation,
    runtime: { kind: "inline", executor: "user-approval" },
    editor: { icon: "user-check", configuration: "user-approval" },
  },
  {
    type: "sleep",
    label: "Sleep",
    description: "Pause the workflow for a fixed duration, then continue.",
    category: "logic",
    inputs: [{ id: "value", type: "any" }],
    outputs: [{ id: "value", type: "any" }],
    defaults: { strategy: "static", options: { duration: "5 minutes" } },
    validation: workflowSleepNodeValidation,
    runtime: { kind: "inline", executor: "sleep" },
    editor: { icon: "timer", configuration: "sleep-duration" },
  },
  {
    type: "http-request",
    label: "Request",
    description: "Call an HTTP endpoint with method, headers, body, and timeout options.",
    category: "network",
    inputs: [
      { id: "url", type: "string" },
      { id: "headers", type: "object" },
      { id: "body", type: "any" },
    ],
    outputs: [
      { id: "ok", type: "any" },
      { id: "status", type: "any" },
      { id: "body", type: "any" },
      { id: "json", type: "any" },
      { id: "text", type: "string" },
      { id: "headers", type: "object" },
    ],
    defaults: {
      strategy: "static",
      options: {
        method: "GET",
        url: "",
        headers: {},
        body: "",
        responseType: "auto",
        timeoutMs: 30_000,
        failOnHttpError: false,
      },
    },
    validation: workflowNodeBaseValidation,
    runtime: { kind: "adapter", adapterCategory: "network" },
    editor: { icon: "globe", configuration: "http-request" },
  },
  {
    type: "isolate-session",
    label: "Isolate Agent",
    description: "Run a lightweight c0 isolate agent with model, prompt, and tool options.",
    category: "session",
    inputs: [
      { id: "context", type: "string" },
      {
        id: "sessionKey",
        type: "string",
        description: "Reuse the same agent session for matching keys.",
      },
      {
        id: "cacheKey",
        type: "string",
        description: "Return a cached response for matching keys while the TTL is valid.",
      },
    ],
    outputs: [
      { id: "sessionId", type: "string" },
      { id: "messageId", type: "string" },
      { id: "output", type: "string" },
      { id: "status", type: "string" },
      { id: "error", type: "string" },
      { id: "cacheHit", type: "boolean" },
      { id: "createdSession", type: "boolean" },
    ],
    defaults: {
      strategy: "static",
      options: {
        model: "",
        reasoningEffort: "",
        prompt: "{{inputs.context}}",
        sessionKey: "",
        cacheKey: "",
        cacheTtlSeconds: "",
        incognito: true,
        subagents: DEFAULT_SUBAGENT_MODE,
        tools: [],
        customMcpServers: getDefaultSessionCustomMcpServers(),
        secretKeys: [],
      },
    },
    validation: workflowIsolateSessionNodeValidation,
    runtime: { kind: "adapter", adapterCategory: "session" },
    editor: { icon: "bot", configuration: "session" },
  },
  {
    type: "sandbox-session",
    label: "Sandbox Agent",
    description: "Run a c0 sandbox agent with model, prompt, and tool options.",
    category: "session",
    inputs: [
      { id: "context", type: "string" },
      {
        id: "sessionKey",
        type: "string",
        description: "Reuse the same agent session for matching keys.",
      },
      {
        id: "cacheKey",
        type: "string",
        description: "Return a cached response for matching keys while the TTL is valid.",
      },
    ],
    outputs: [
      { id: "sessionId", type: "string" },
      { id: "messageId", type: "string" },
      { id: "output", type: "string" },
      { id: "status", type: "string" },
      { id: "error", type: "string" },
      { id: "cacheHit", type: "boolean" },
      { id: "createdSession", type: "boolean" },
    ],
    defaults: {
      strategy: "static",
      options: {
        model: "",
        reasoningEffort: "",
        prompt: "{{inputs.context}}",
        sessionKey: "",
        cacheKey: "",
        cacheTtlSeconds: "",
        incognito: true,
        tools: [],
        customMcpServers: getDefaultSessionCustomMcpServers(),
        secretKeys: [],
      },
    },
    validation: workflowNodeBaseValidation,
    runtime: { kind: "adapter", adapterCategory: "session" },
    editor: { icon: "box", configuration: "session" },
  },
  {
    type: "slack-send-message",
    label: "Send Slack Message",
    description: "Post a Slack message or blocks with the workflow Slack app bot token.",
    category: "slack",
    inputs: [
      { id: "token", type: "string" },
      { id: "channel", type: "string" },
      { id: "text", type: "string" },
      { id: "threadTs", type: "string" },
      { id: "blocks", type: "any" },
    ],
    outputs: [
      { id: "ok", type: "boolean" },
      { id: "channel", type: "string" },
      { id: "ts", type: "string" },
      { id: "message", type: "object" },
    ],
    defaults: {
      strategy: "static",
      options: { channel: "", text: "{{inputs.text}}", threadTs: "", blocks: "" },
    },
    validation: workflowNodeBaseValidation,
    runtime: { kind: "adapter", adapterCategory: "slack" },
    editor: { icon: "message", configuration: "slack-action" },
  },
  {
    type: "slack-join-channel",
    label: "Join Slack Channel",
    description: "Join a Slack channel with the workflow Slack app bot token.",
    category: "slack",
    inputs: [
      { id: "token", type: "string" },
      { id: "channel", type: "string" },
    ],
    outputs: [
      { id: "ok", type: "boolean" },
      { id: "channel", type: "string" },
    ],
    defaults: { strategy: "static", options: { channel: "" } },
    validation: workflowNodeBaseValidation,
    runtime: { kind: "adapter", adapterCategory: "slack" },
    editor: { icon: "message", configuration: "slack-action" },
  },
  {
    type: "slack-fetch-thread",
    label: "Fetch Slack Thread",
    description: "Read recent Slack thread messages for workflow context.",
    category: "slack",
    inputs: [
      { id: "token", type: "string" },
      { id: "channel", type: "string" },
      { id: "threadTs", type: "string" },
      { id: "limit", type: "any" },
    ],
    outputs: [
      { id: "ok", type: "boolean" },
      { id: "channel", type: "string" },
      { id: "threadTs", type: "string" },
      { id: "messages", type: "object" },
      { id: "text", type: "string" },
    ],
    defaults: { strategy: "static", options: { channel: "", threadTs: "", limit: 20 } },
    validation: workflowNodeBaseValidation,
    runtime: { kind: "adapter", adapterCategory: "slack" },
    editor: { icon: "message", configuration: "slack-action" },
  },
  {
    type: "slack-add-reaction",
    label: "Add Slack Reaction",
    description: "Add a Slack reaction to acknowledge a message.",
    category: "slack",
    inputs: [
      { id: "token", type: "string" },
      { id: "channel", type: "string" },
      { id: "timestamp", type: "string" },
      { id: "name", type: "string" },
    ],
    outputs: [
      { id: "ok", type: "boolean" },
      { id: "channel", type: "string" },
      { id: "ts", type: "string" },
      { id: "name", type: "string" },
    ],
    defaults: { strategy: "static", options: { channel: "", timestamp: "", name: "eyes" } },
    validation: workflowNodeBaseValidation,
    runtime: { kind: "adapter", adapterCategory: "slack" },
    editor: { icon: "message", configuration: "slack-action" },
  },
  {
    type: "slack-remove-reaction",
    label: "Remove Slack Reaction",
    description: "Remove a Slack reaction from a message.",
    category: "slack",
    inputs: [
      { id: "token", type: "string" },
      { id: "channel", type: "string" },
      { id: "timestamp", type: "string" },
      { id: "name", type: "string" },
    ],
    outputs: [
      { id: "ok", type: "boolean" },
      { id: "channel", type: "string" },
      { id: "ts", type: "string" },
      { id: "name", type: "string" },
    ],
    defaults: { strategy: "static", options: { channel: "", timestamp: "", name: "eyes" } },
    validation: workflowNodeBaseValidation,
    runtime: { kind: "adapter", adapterCategory: "slack" },
    editor: { icon: "message", configuration: "slack-action" },
  },
  {
    type: "email-notification",
    label: "Email",
    description: "Send a workflow notification by email.",
    category: "notification",
    inputs: [
      { id: "to", type: "string" },
      { id: "subject", type: "string" },
      { id: "body", type: "string" },
    ],
    outputs: [
      { id: "ok", type: "boolean" },
      { id: "to", type: "string" },
      { id: "provider", type: "string" },
    ],
    defaults: {
      strategy: "static",
      options: { to: "", from: "", subject: "", body: "Workflow notification" },
    },
    validation: workflowNodeBaseValidation,
    runtime: { kind: "adapter", adapterCategory: "notification" },
    editor: { icon: "mail", configuration: "notification" },
  },
  {
    type: "r2-put-object",
    label: "Save to R2",
    description: "Write workflow output to a configured R2 bucket.",
    category: "storage",
    inputs: [
      { id: "content", type: "any" },
      { id: "key", type: "string" },
    ],
    outputs: [
      { id: "bucket", type: "string" },
      { id: "key", type: "string" },
      { id: "etag", type: "string" },
      { id: "contentType", type: "string" },
    ],
    defaults: {
      strategy: "static",
      options: {
        bucket: "WORKFLOW_BUCKET",
        key: "workflow-outputs/{{workflowId}}/{{runId}}/{{nodeId}}.json",
        contentType: "application/json",
        encoding: "text",
      },
    },
    validation: workflowStorageNodeValidation,
    runtime: { kind: "adapter", adapterCategory: "storage" },
    editor: { icon: "database", configuration: "r2-object" },
  },
  {
    type: "r2-get-object",
    label: "Get from R2",
    description: "Read workflow data from a configured R2 bucket.",
    category: "storage",
    inputs: [{ id: "key", type: "string" }],
    outputs: [
      { id: "found", type: "boolean" },
      { id: "bucket", type: "string" },
      { id: "key", type: "string" },
      { id: "body", type: "any" },
      { id: "json", type: "any" },
      { id: "text", type: "string" },
      { id: "etag", type: "string" },
      { id: "contentType", type: "string" },
    ],
    defaults: {
      strategy: "static",
      options: { bucket: "WORKFLOW_BUCKET", key: "", responseType: "auto" },
    },
    validation: workflowStorageNodeValidation,
    runtime: { kind: "adapter", adapterCategory: "storage" },
    editor: { icon: "database", configuration: "r2-object" },
  },
  {
    type: "kv-put",
    label: "Save to KV",
    description: "Write workflow output to a configured KV namespace.",
    category: "storage",
    inputs: [
      { id: "value", type: "any" },
      { id: "key", type: "string" },
    ],
    outputs: [
      { id: "namespace", type: "string" },
      { id: "key", type: "string" },
      { id: "expirationTtl", type: "any" },
    ],
    defaults: {
      strategy: "static",
      options: {
        namespace: "USER_WORKFLOW_KV",
        key: "workflow-outputs/{{workflowId}}/{{runId}}/{{nodeId}}.json",
        expirationTtl: "",
      },
    },
    validation: workflowStorageNodeValidation,
    runtime: { kind: "adapter", adapterCategory: "storage" },
    editor: { icon: "key", configuration: "kv-entry" },
  },
  {
    type: "kv-get",
    label: "Get from KV",
    description: "Read workflow data from a configured KV namespace.",
    category: "storage",
    inputs: [{ id: "key", type: "string" }],
    outputs: [
      { id: "found", type: "boolean" },
      { id: "namespace", type: "string" },
      { id: "key", type: "string" },
      { id: "value", type: "any" },
      { id: "json", type: "any" },
      { id: "text", type: "string" },
    ],
    defaults: {
      strategy: "static",
      options: { namespace: "USER_WORKFLOW_KV", key: "", responseType: "auto" },
    },
    validation: workflowStorageNodeValidation,
    runtime: { kind: "adapter", adapterCategory: "storage" },
    editor: { icon: "key", configuration: "kv-entry" },
  },
  {
    type: "get-secret",
    label: "Get Secret",
    description: "Read one of the current user's configured secrets.",
    category: "storage",
    inputs: [{ id: "key", type: "string" }],
    outputs: [
      { id: "found", type: "boolean" },
      { id: "key", type: "string" },
      { id: "value", type: "string" },
    ],
    defaults: { strategy: "static", options: { key: "" } },
    validation: workflowNodeBaseValidation,
    runtime: { kind: "adapter", adapterCategory: "storage" },
    editor: { icon: "key", configuration: "none" },
  },
] as const satisfies readonly WorkflowNodeDefinition[]

type WorkflowNodeCatalogType = (typeof WORKFLOW_NODE_CATALOG)[number]["type"]
type WorkflowNodeCatalogMissingTypes = Exclude<WorkflowNodeType, WorkflowNodeCatalogType>
type WorkflowNodeCatalogUnknownTypes = Exclude<WorkflowNodeCatalogType, WorkflowNodeType>
type WorkflowNodeCatalogCompleteness = [
  WorkflowNodeCatalogMissingTypes,
  WorkflowNodeCatalogUnknownTypes,
] extends [never, never]
  ? true
  : never

export const WORKFLOW_NODE_CATALOG_COMPLETE: WorkflowNodeCatalogCompleteness = true
