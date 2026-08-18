import { parseJsonRecord, stringifyJson } from "./json"
import { isSubagentMode } from "./subagents"

import {
  WORKFLOW_KV_NAMESPACE_OPTIONS,
  WORKFLOW_NODE_CATALOG,
  WORKFLOW_NODE_TYPES,
  WORKFLOW_R2_BUCKET_OPTIONS,
  WORKFLOW_STORAGE_ENCODING_OPTIONS,
  type WorkflowActionNodeType,
  type WorkflowKvNamespaceBinding,
  type WorkflowNodeDefinition,
  type WorkflowNodeRuntimeSupport,
  type WorkflowNodeType,
  type WorkflowNodeValidationSupport,
  type WorkflowR2BucketBinding,
  type WorkflowStorageEncoding,
  type WorkflowTriggerNodeType,
} from "./workflow-nodes/definitions"

export {
  WORKFLOW_KV_NAMESPACE_OPTIONS,
  WORKFLOW_NODE_CATALOG,
  WORKFLOW_NODE_CATALOG_COMPLETE,
  WORKFLOW_NODE_TYPES,
  WORKFLOW_R2_BUCKET_OPTIONS,
  WORKFLOW_STORAGE_ENCODING_OPTIONS,
} from "./workflow-nodes/definitions"
export type {
  WorkflowActionNodeType,
  WorkflowKvNamespaceBinding,
  WorkflowNodeAdapterCategory,
  WorkflowNodeCategory,
  WorkflowNodeDefaultOptionsDefinition,
  WorkflowNodeDefinition,
  WorkflowNodeEditorConfiguration,
  WorkflowNodeEditorIcon,
  WorkflowNodeEditorSupport,
  WorkflowNodeInlineExecutor,
  WorkflowNodeOptionValidationRule,
  WorkflowNodeRuntimeSupport,
  WorkflowNodeType,
  WorkflowNodeTriggerKind,
  WorkflowNodeValidationSupport,
  WorkflowPortDefinition,
  WorkflowR2BucketBinding,
  WorkflowStorageEncoding,
  WorkflowTriggerNodeType,
} from "./workflow-nodes/definitions"

export const WORKFLOW_JSON_OBJECT_FIELD_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*$/

// Matches Cloudflare Workflows sleep durations such as "30 seconds", "5 minutes", or "1 day".
export const WORKFLOW_SLEEP_DURATION_PATTERN =
  /^\s*[1-9]\d*\s*(?:second|minute|hour|day|week|month|year)s?\s*$/i

export function isValidWorkflowSleepDuration(value: unknown): boolean {
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0
  }
  return typeof value === "string" && WORKFLOW_SLEEP_DURATION_PATTERN.test(value)
}

interface WorkflowNodeOptionTarget {
  id: string
  type: string
  options: Record<string, unknown>
}

interface WorkflowNodeValidationGraph {
  nodes: WorkflowNodeOptionTarget[]
  edges: Array<{
    target: string
    targetHandle?: string | null
  }>
}

export function getWorkflowNodeDefaultOptions(
  type: string,
  options: { now?: Date | number } = {},
): Record<string, unknown> {
  if (!isWorkflowNodeType(type)) {
    return {}
  }

  const defaults = getWorkflowNodeDefinition(type).defaults
  if (defaults.strategy === "static") {
    return cloneWorkflowNodeDefaultOptions(defaults.options)
  }

  return {
    [defaults.option]: new Date(readNowMs(options.now) + defaults.offsetMs).toISOString(),
  }
}

export function getWorkflowJsonObjectFields(
  node: Pick<WorkflowNodeOptionTarget, "type" | "options">,
): string[] {
  if (node.type !== "json-object") {
    return []
  }

  const fields = Array.isArray(node.options.fields) ? node.options.fields : ["value"]
  const uniqueFields: string[] = []
  const seen = new Set<string>()
  fields.forEach((field) => {
    const key = typeof field === "string" ? field.trim() : ""
    if (!key || seen.has(key)) {
      return
    }
    uniqueFields.push(key)
    seen.add(key)
  })
  return uniqueFields
}

const workflowNodeTypeSet = new Set<WorkflowNodeType>(WORKFLOW_NODE_TYPES)

export function isWorkflowNodeType(value: string): value is WorkflowNodeType {
  return workflowNodeTypeSet.has(value as WorkflowNodeType)
}

export function isWorkflowTriggerNodeType(
  value: WorkflowNodeType,
): value is WorkflowTriggerNodeType {
  return getWorkflowNodeRuntimeSupport(value).kind === "trigger"
}

export function isWorkflowActionNodeType(value: WorkflowNodeType): value is WorkflowActionNodeType {
  return !isWorkflowTriggerNodeType(value)
}

export function getWorkflowNodeDefinition(type: WorkflowNodeType): WorkflowNodeDefinition {
  const definition = WORKFLOW_NODE_CATALOG.find((item) => item.type === type)
  if (!definition) {
    throw new Error(`Unknown workflow node type '${type}'`)
  }
  return definition
}

export function getWorkflowNodeRuntimeSupport(type: WorkflowNodeType): WorkflowNodeRuntimeSupport {
  return getWorkflowNodeDefinition(type).runtime
}

export function getWorkflowNodeDefinitionForNode(
  node: Pick<WorkflowNodeOptionTarget, "type" | "options"> & { type: WorkflowNodeType },
): WorkflowNodeDefinition {
  const definition = getWorkflowNodeDefinition(node.type)
  if (node.type !== "json-object") {
    return definition
  }

  const fields = getWorkflowJsonObjectFields(node)
  const hasConfiguredFields = Array.isArray(node.options.fields)
  return {
    ...definition,
    inputs: hasConfiguredFields
      ? fields.map((field) => ({ id: field, type: "any" as const }))
      : definition.inputs,
  }
}

export function getNextWorkflowJsonObjectFieldName(fields: string[], now = Date.now()): string {
  if (!fields.includes("value")) {
    return "value"
  }
  const candidate = Array.from(
    { length: 99 },
    (_, offset) => `value${fields.length + 1 + offset}`,
  ).find((name) => !fields.includes(name))
  return candidate ?? `value${now.toString(36)}`
}

export function validateWorkflowJsonObjectFieldName(value: string): boolean {
  return WORKFLOW_JSON_OBJECT_FIELD_NAME_PATTERN.test(value)
}

export function validateWorkflowNodeOptions(manifest: WorkflowNodeValidationGraph): {
  errors: string[]
  warnings: string[]
} {
  const errors: string[] = []
  const warnings: string[] = []

  manifest.nodes.forEach((node) => {
    const validation = getWorkflowNodeValidationSupport(node.type)
    if (!validation) {
      return
    }

    if (validation.optionRules.includes("storage-binding")) {
      errors.push(...validateStorageNodeOptions(node))
    }
    if (validation.optionRules.includes("isolate-subagents")) {
      errors.push(...validateIsolateSubagentOptions(node))
    }
    if (validation.optionRules.includes("json-object-fields")) {
      errors.push(...validateJsonObjectNodeOptions(node))
      warnings.push(...collectJsonObjectNodeWarnings(node))
    }
    if (validation.optionRules.includes("sleep-duration")) {
      errors.push(...validateSleepNodeOptions(node))
    }
    if (validation.optionRules.includes("storage-key-portability")) {
      warnings.push(...collectStorageNodeWarnings(node))
    }
  })

  return { errors, warnings }
}

export function validateWorkflowNodeTemplateReferences(
  manifest: WorkflowNodeValidationGraph,
): string[] {
  const errors: string[] = []

  manifest.nodes.forEach((node) => {
    const validation = getWorkflowNodeValidationSupport(node.type)
    if (validation?.templateReferences !== "connected-inputs") {
      return
    }

    const references: Array<{ optionPath: string; templatePath: string }> = []
    collectStringTemplateReferences(node.options, "options", references)

    if (references.length === 0) {
      return
    }

    const connectedInputHandles = getConnectedInputHandles(manifest, node)
    references.forEach((reference) => {
      const [root, inputHandle] = reference.templatePath.split(".")
      if (root === "inputs") {
        if (!inputHandle && connectedInputHandles.size === 0) {
          errors.push(
            `Workflow node '${node.id}' option '${reference.optionPath}' references inputs, but the node has no connected inputs`,
          )
          return
        }
        if (inputHandle && !connectedInputHandles.has(inputHandle)) {
          errors.push(
            `Workflow node '${node.id}' option '${reference.optionPath}' references unavailable input '${inputHandle}'. Connect an upstream output to '${inputHandle}' before using '{{${reference.templatePath}}}'`,
          )
        }
        return
      }

      if (root === "nodes" || root === "trigger") {
        errors.push(
          `Workflow node '${node.id}' option '${reference.optionPath}' references '{{${reference.templatePath}}}', but workflow templates can only read connected inputs. Connect that output to this node and use '{{inputs.<input>}}'`,
        )
        return
      }

      if (!workflowMetadataTemplateRoots.has(root ?? "")) {
        errors.push(
          `Workflow node '${node.id}' option '${reference.optionPath}' references unknown template root '${root}'`,
        )
      }
    })
  })

  return errors
}

function readNowMs(now: Date | number | undefined): number {
  if (now instanceof Date) {
    return now.getTime()
  }
  if (typeof now === "number") {
    return now
  }
  return Date.now()
}

function getWorkflowNodeValidationSupport(type: string): WorkflowNodeValidationSupport | null {
  return isWorkflowNodeType(type) ? getWorkflowNodeDefinition(type).validation : null
}

function cloneWorkflowNodeDefaultOptions(
  options: Record<string, unknown>,
): Record<string, unknown> {
  return parseJsonRecord(stringifyJson(options))
}

function getBindingValue(options: Record<string, unknown>, key: string): string | null {
  const value = options[key]
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function keyLooksUserScoped(value: string): boolean {
  const firstSegment = value.split("/")[0] ?? ""
  return (
    /^user[_-][A-Za-z0-9_-]+$/.test(firstSegment) ||
    /^usr_[A-Za-z0-9_-]+$/.test(firstSegment) ||
    /^00u[A-Za-z0-9]{10,}$/.test(firstSegment) ||
    (/^(?=.*[A-Z])(?=.*\d)[A-Za-z0-9_-]{20,}$/.test(firstSegment) && !firstSegment.includes("-"))
  )
}

function validateStorageNodeOptions(node: WorkflowNodeOptionTarget): string[] {
  const errors: string[] = []
  const r2Bindings = new Set(WORKFLOW_R2_BUCKET_OPTIONS.map((option) => option.binding))
  const kvBindings = new Set(WORKFLOW_KV_NAMESPACE_OPTIONS.map((option) => option.binding))

  if (node.type === "r2-put-object" || node.type === "r2-get-object") {
    const bucket = getBindingValue(node.options, "bucket")
    if (bucket && !r2Bindings.has(bucket as WorkflowR2BucketBinding)) {
      errors.push(`Workflow node '${node.id}' uses unsupported R2 bucket '${bucket}'`)
    }
  }

  if (node.type === "r2-put-object") {
    const encoding = getBindingValue(node.options, "encoding")
    const storageEncodings = new Set(
      WORKFLOW_STORAGE_ENCODING_OPTIONS.map((option) => option.value),
    )
    if (encoding && !storageEncodings.has(encoding as WorkflowStorageEncoding)) {
      errors.push(`Workflow node '${node.id}' uses unsupported R2 content encoding '${encoding}'`)
    }
  }

  if (node.type === "kv-put" || node.type === "kv-get") {
    const namespace = getBindingValue(node.options, "namespace")
    if (namespace && !kvBindings.has(namespace as WorkflowKvNamespaceBinding)) {
      errors.push(`Workflow node '${node.id}' uses unsupported KV namespace '${namespace}'`)
    }
  }

  return errors
}

function validateIsolateSubagentOptions(node: WorkflowNodeOptionTarget): string[] {
  const value = node.options.subagents
  if (node.type !== "isolate-session" || value === undefined || isSubagentMode(value)) {
    return []
  }
  return [
    `Workflow node '${node.id}' uses unsupported sub-agent mode '${String(value)}'. Expected 'enabled' or 'disabled'.`,
  ]
}

function collectStorageNodeWarnings(node: WorkflowNodeOptionTarget): string[] {
  if (
    node.type !== "r2-put-object" &&
    node.type !== "r2-get-object" &&
    node.type !== "kv-put" &&
    node.type !== "kv-get"
  ) {
    return []
  }

  const key = getBindingValue(node.options, "key")
  if (!key || !keyLooksUserScoped(key)) {
    return []
  }

  return [
    `Workflow node '${node.id}' has a storage key that appears to include a user prefix. Imported workflows run under the current user's userId prefix automatically.`,
  ]
}

function validateJsonObjectNodeOptions(node: WorkflowNodeOptionTarget): string[] {
  if (node.type !== "json-object" || !Array.isArray(node.options.fields)) {
    return []
  }

  const fields = node.options.fields.map((field) => (typeof field === "string" ? field.trim() : ""))
  const seen = new Set<string>()
  const errors: string[] = []
  fields.forEach((field) => {
    if (!field) {
      errors.push(`Workflow node '${node.id}' has an empty JSON object field`)
      return
    }
    if (!validateWorkflowJsonObjectFieldName(field)) {
      errors.push(
        `Workflow node '${node.id}' has invalid JSON object field '${field}'. Field names must start with a letter or underscore and contain only letters, numbers, underscores, or hyphens.`,
      )
      return
    }
    if (seen.has(field)) {
      errors.push(`Workflow node '${node.id}' has duplicate JSON object field '${field}'`)
      return
    }
    seen.add(field)
  })
  return errors
}

function validateSleepNodeOptions(node: WorkflowNodeOptionTarget): string[] {
  if (node.type !== "sleep") {
    return []
  }
  const duration = node.options.duration
  if (duration === undefined || duration === "" || isValidWorkflowSleepDuration(duration)) {
    return []
  }
  return [
    `Workflow node '${node.id}' has invalid sleep duration '${String(duration)}'. Use a positive number of milliseconds or a duration such as '30 seconds', '5 minutes', or '1 day'.`,
  ]
}

function collectJsonObjectNodeWarnings(node: WorkflowNodeOptionTarget): string[] {
  if (node.type !== "json-object" || !Array.isArray(node.options.fields)) {
    return []
  }

  const fields = node.options.fields.map((field) => (typeof field === "string" ? field.trim() : ""))
  return fields.length === 0
    ? [`Workflow node '${node.id}' has no JSON object fields configured`]
    : []
}

const workflowTemplatePathPattern = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g
const workflowMetadataTemplateRoots = new Set([
  "workflowId",
  "runId",
  "nodeId",
  "userId",
  "oktaUserId",
])

function collectStringTemplateReferences(
  value: unknown,
  path: string,
  references: Array<{ optionPath: string; templatePath: string }>,
): void {
  if (typeof value === "string") {
    Array.from(value.matchAll(workflowTemplatePathPattern)).forEach((match) => {
      references.push({ optionPath: path, templatePath: match[1] ?? "" })
    })
    return
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectStringTemplateReferences(item, `${path}[${index}]`, references),
    )
    return
  }

  if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, nestedValue]) => {
      collectStringTemplateReferences(nestedValue, `${path}.${key}`, references)
    })
  }
}

function getConnectedInputHandles(
  manifest: WorkflowNodeValidationGraph,
  node: WorkflowNodeOptionTarget,
): Set<string> {
  const handles = new Set(
    manifest.edges
      .filter((edge) => edge.target === node.id)
      .map((edge) => edge.targetHandle || "input"),
  )
  if (
    node.options.inputValues &&
    typeof node.options.inputValues === "object" &&
    !Array.isArray(node.options.inputValues)
  ) {
    Object.keys(node.options.inputValues).forEach((handle) => {
      if (handle) {
        handles.add(handle)
      }
    })
  }
  return handles
}
