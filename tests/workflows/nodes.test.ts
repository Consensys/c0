import { describe, expect, it } from "vitest"
import {
  getNextWorkflowJsonObjectFieldName,
  getWorkflowNodeDefinition,
  getWorkflowNodeDefaultOptions,
  validateWorkflowJsonObjectFieldName,
  validateWorkflowNodeOptions,
  validateWorkflowNodeTemplateReferences,
} from "../../packages/shared/src/workflow-nodes"
import { getDefaultSessionCustomMcpServers } from "../../packages/shared/src/session-tools"

describe("workflow node module", () => {
  it("owns default options for authored workflow nodes", () => {
    expect(
      getWorkflowNodeDefaultOptions("datetime-trigger", {
        now: Date.parse("2026-05-13T16:00:00.000Z"),
      }),
    ).toEqual({
      scheduledAt: "2026-05-13T17:00:00.000Z",
    })
    expect(getWorkflowNodeDefaultOptions("sandbox-session")).toMatchObject({
      model: "",
      prompt: "{{inputs.context}}",
      sessionKey: "",
      cacheKey: "",
      cacheTtlSeconds: "",
      incognito: true,
      customMcpServers: getDefaultSessionCustomMcpServers(),
    })
    expect(getWorkflowNodeDefaultOptions("sandbox-session")).not.toHaveProperty("subagents")
    expect(getWorkflowNodeDefaultOptions("isolate-session")).toMatchObject({
      subagents: "enabled",
    })
    expect(getWorkflowNodeDefaultOptions("r2-put-object")).toMatchObject({
      bucket: "WORKFLOW_BUCKET",
      key: "workflow-outputs/{{workflowId}}/{{runId}}/{{nodeId}}.json",
      encoding: "text",
    })
    expect(getWorkflowNodeDefaultOptions("slack-trigger")).toMatchObject({
      surface: "event",
      eventTypes: ["app_mention", "message"],
      dedupeWindowSeconds: 300,
    })
  })

  it("exposes Slack trigger and Slack action ports", () => {
    expect(getWorkflowNodeDefinition("slack-trigger").outputs.map((output) => output.id)).toEqual([
      "teamId",
      "channelId",
      "channelName",
      "userId",
      "text",
      "eventType",
      "command",
      "messageTs",
      "threadTs",
      "triggerId",
      "actionId",
      "responseUrl",
      "rawPayload",
    ])
    expect(getWorkflowNodeDefinition("slack-send-message").runtime).toEqual({
      kind: "adapter",
      adapterCategory: "slack",
    })
  })

  it("exposes cache and reuse inputs on session nodes", () => {
    const definition = getWorkflowNodeDefinition("isolate-session")
    expect(definition.inputs.map((input) => input.id)).toEqual([
      "context",
      "sessionKey",
      "cacheKey",
    ])
    expect(definition.outputs.map((output) => output.id)).toEqual([
      "sessionId",
      "messageId",
      "output",
      "status",
      "error",
      "cacheHit",
      "createdSession",
    ])

    const validation = validateWorkflowNodeTemplateReferences({
      nodes: [
        {
          id: "agent",
          type: "isolate-session",
          options: {
            sessionKey: "{{inputs.sessionKey}}",
            cacheKey: "{{inputs.cacheKey}}",
          },
        },
      ],
      edges: [
        { target: "agent", targetHandle: "sessionKey" },
        { target: "agent", targetHandle: "cacheKey" },
      ],
    })

    expect(validation).toEqual([])
  })

  it("owns JSON object field naming rules", () => {
    expect(validateWorkflowJsonObjectFieldName("alertId")).toBe(true)
    expect(validateWorkflowJsonObjectFieldName("bad.field")).toBe(false)
    expect(getNextWorkflowJsonObjectFieldName(["value", "value2"])).toBe("value3")
  })

  it("validates storage and JSON object options in one node-level pass", () => {
    const validation = validateWorkflowNodeOptions({
      nodes: [
        {
          id: "save",
          type: "r2-put-object",
          options: {
            bucket: "DO_NOT_USE",
            encoding: "binary",
            key: "00u123456789012345/workflow-outputs/{{runId}}.json",
          },
        },
        {
          id: "combine",
          type: "json-object",
          options: { fields: ["alertId", "alertId", "bad.field"] },
        },
      ],
      edges: [],
    })

    expect(validation.errors).toEqual([
      "Workflow node 'save' uses unsupported R2 bucket 'DO_NOT_USE'",
      "Workflow node 'save' uses unsupported R2 content encoding 'binary'",
      "Workflow node 'combine' has duplicate JSON object field 'alertId'",
      "Workflow node 'combine' has invalid JSON object field 'bad.field'. Field names must start with a letter or underscore and contain only letters, numbers, underscores, or hyphens.",
    ])
    expect(validation.warnings).toEqual([
      "Workflow node 'save' has a storage key that appears to include a user prefix. Imported workflows run under the current user's userId prefix automatically.",
    ])
  })

  it("rejects invalid Isolate sub-agent modes without applying the option to Sandbox nodes", () => {
    const invalid = validateWorkflowNodeOptions({
      nodes: [
        {
          id: "isolate",
          type: "isolate-session",
          options: { subagents: "sometimes" },
        },
        {
          id: "sandbox",
          type: "sandbox-session",
          options: { subagents: "sometimes" },
        },
      ],
      edges: [],
    })

    expect(invalid.errors).toEqual([
      "Workflow node 'isolate' uses unsupported sub-agent mode 'sometimes'. Expected 'enabled' or 'disabled'.",
    ])
    expect(
      validateWorkflowNodeOptions({
        nodes: [
          { id: "enabled", type: "isolate-session", options: { subagents: "enabled" } },
          { id: "disabled", type: "isolate-session", options: { subagents: "disabled" } },
          { id: "default", type: "isolate-session", options: {} },
        ],
        edges: [],
      }).errors,
    ).toEqual([])
  })

  it("exposes the sleep node as an inline logic pass-through with a default duration", () => {
    const definition = getWorkflowNodeDefinition("sleep")
    expect(definition.category).toBe("logic")
    expect(definition.runtime).toEqual({ kind: "inline", executor: "sleep" })
    expect(definition.inputs.map((input) => input.id)).toEqual(["value"])
    expect(definition.outputs.map((output) => output.id)).toEqual(["value"])
    expect(getWorkflowNodeDefaultOptions("sleep")).toEqual({ duration: "5 minutes" })
  })

  it("validates sleep durations against Cloudflare Workflows duration labels", () => {
    expect(
      validateWorkflowNodeOptions({
        nodes: [
          { id: "seconds", type: "sleep", options: { duration: "30 seconds" } },
          { id: "minutes", type: "sleep", options: { duration: "5 minutes" } },
          { id: "day", type: "sleep", options: { duration: "1 day" } },
          { id: "millis", type: "sleep", options: { duration: 300_000 } },
          { id: "default", type: "sleep", options: {} },
        ],
        edges: [],
      }).errors,
    ).toEqual([])

    expect(
      validateWorkflowNodeOptions({
        nodes: [
          { id: "fortnight", type: "sleep", options: { duration: "2 fortnights" } },
          { id: "zero", type: "sleep", options: { duration: 0 } },
        ],
        edges: [],
      }).errors,
    ).toEqual([
      "Workflow node 'fortnight' has invalid sleep duration '2 fortnights'. Use a positive number of milliseconds or a duration such as '30 seconds', '5 minutes', or '1 day'.",
      "Workflow node 'zero' has invalid sleep duration '0'. Use a positive number of milliseconds or a duration such as '30 seconds', '5 minutes', or '1 day'.",
    ])
  })

  it("validates template references against connected inputs", () => {
    expect(
      validateWorkflowNodeTemplateReferences({
        nodes: [
          {
            id: "request",
            type: "http-request",
            options: {
              url: "https://example.com/{{nodes.manual.payload}}/{{inputs.body.id}}",
              body: "{{unknownRoot.value}}",
            },
          },
        ],
        edges: [{ target: "request", targetHandle: "body" }],
      }),
    ).toEqual([
      "Workflow node 'request' option 'options.url' references '{{nodes.manual.payload}}', but workflow templates can only read connected inputs. Connect that output to this node and use '{{inputs.<input>}}'",
      "Workflow node 'request' option 'options.body' references unknown template root 'unknownRoot'",
    ])
  })
})
