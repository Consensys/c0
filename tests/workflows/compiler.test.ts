import { createContext, Script } from "node:vm"
import { describe, expect, it } from "vitest"
import { compileWorkflowToJavaScript } from "../../packages/api/src/server/background/workflows/compiler"
import {
  CURRENT_WORKFLOW_RUNTIME_ABI_VERSION,
  getCurrentWorkflowRuntimeKernel,
} from "../../packages/api/src/server/background/workflows/runtime-abi"
import { WORKFLOW_MANIFEST_VERSION, type WorkflowManifest } from "../../packages/shared/src"

function defaultManifest(): WorkflowManifest {
  return {
    version: WORKFLOW_MANIFEST_VERSION,
    name: "Default workflow",
    nodes: [
      {
        id: "webhook",
        type: "webhook-trigger",
        label: "Webhook",
        position: { x: 80, y: 140 },
        options: {},
      },
      {
        id: "javascript",
        type: "javascript",
        label: "Normalize payload",
        position: { x: 360, y: 140 },
        options: {
          code: "return inputs.payload ?? null",
        },
      },
      {
        id: "isolate",
        type: "isolate-session",
        label: "Run isolate session",
        position: { x: 650, y: 140 },
        options: {
          model: "litellm/gpt-5.4-mini",
          reasoningEffort: "",
          prompt: "{{inputs.context}}",
          tools: [],
          customMcpServers: {},
        },
      },
    ],
    edges: [
      {
        id: "webhook-body-javascript",
        source: "webhook",
        target: "javascript",
        sourceHandle: "body",
        targetHandle: "payload",
      },
      {
        id: "javascript-result-isolate",
        source: "javascript",
        target: "isolate",
        sourceHandle: "result",
        targetHandle: "context",
      },
    ],
  }
}

function createTestableWorkflowRuntime(manifest: WorkflowManifest): string {
  const runtimeKernel = getCurrentWorkflowRuntimeKernel()
  return compileWorkflowToJavaScript(manifest)
    .replace(
      'import { WorkflowEntrypoint } from "cloudflare:workers";\n',
      "class WorkflowEntrypoint {}\n",
    )
    .replace(
      `import { createWorkflowRuntimeKernel, normalizeActionResult } from "./${runtimeKernel.moduleName}";\n`,
      `${runtimeKernel.source.replace(/^export /gm, "")}\n`,
    )
    .replace("export class TenantWorkflow", "class TenantWorkflow")
}

describe("compileWorkflowToJavaScript", () => {
  it("orders default trigger-to-action workflows without treating trigger edges as cycles", () => {
    const code = compileWorkflowToJavaScript(defaultManifest())

    expect(code).toContain('"javascript",\n  "isolate"')
    expect(code).toContain(
      `import { createWorkflowRuntimeKernel, normalizeActionResult } from "./${getCurrentWorkflowRuntimeKernel().moduleName}";`,
    )
    expect(code).toContain(
      `const WORKFLOW_RUNTIME_ABI_VERSION = ${CURRENT_WORKFLOW_RUNTIME_ABI_VERSION};`,
    )
    expect(code).toContain("const userId =")
    expect(code).toContain("manifestVersion: MANIFEST.version")
    expect(code).toContain("userId: context.userId")
    expect(code).not.toContain("nodes: context.outputs")
    expect(code).toContain('const ACTION_STEP_CONFIG = { timeout: "30 minutes" };')
    expect(code).toContain('step.do(node.id + ":action", ACTION_STEP_CONFIG')
  })

  it("creates initial outputs for manual trigger nodes", () => {
    const manifest = defaultManifest()
    manifest.nodes[0] = {
      id: "manual",
      type: "manual-trigger",
      label: "Manual",
      position: { x: 80, y: 140 },
      options: {},
    }
    manifest.edges[0] = {
      id: "manual-payload-javascript",
      source: "manual",
      target: "javascript",
      sourceHandle: "payload",
      targetHandle: "payload",
    }

    const code = compileWorkflowToJavaScript(manifest)

    expect(code).toContain("KERNEL.createInitialOutputs")
    expect(code).toContain('"sourceHandle": "payload"')
  })

  it("creates initial outputs for cron trigger nodes", () => {
    const manifest = defaultManifest()
    manifest.nodes[0] = {
      id: "cron",
      type: "cron-trigger",
      label: "Cron",
      position: { x: 80, y: 140 },
      options: { cron: "0 * * * *" },
    }
    manifest.edges[0] = {
      id: "cron-fired-javascript",
      source: "cron",
      target: "javascript",
      sourceHandle: "firedAt",
      targetHandle: "payload",
    }

    const code = compileWorkflowToJavaScript(manifest)

    expect(code).toContain("KERNEL.createInitialOutputs")
    expect(code).toContain('"sourceHandle": "firedAt"')
  })

  it("combines connected inputs into JSON object node output", async () => {
    const manifest: WorkflowManifest = {
      version: WORKFLOW_MANIFEST_VERSION,
      name: "Combine values",
      nodes: [
        {
          id: "manual",
          type: "manual-trigger",
          label: "Manual",
          position: { x: 80, y: 140 },
          options: {},
        },
        {
          id: "javascript",
          type: "javascript",
          label: "Normalize",
          position: { x: 360, y: 140 },
          options: {
            code: "return { ok: true, value: inputs.payload.value }",
          },
        },
        {
          id: "combine",
          type: "json-object",
          label: "JSON Object",
          position: { x: 650, y: 140 },
          options: {
            fields: ["original", "normalized", "missing"],
          },
        },
      ],
      edges: [
        {
          id: "manual-javascript",
          source: "manual",
          target: "javascript",
          sourceHandle: "payload",
          targetHandle: "payload",
        },
        {
          id: "manual-combine",
          source: "manual",
          target: "combine",
          sourceHandle: "payload",
          targetHandle: "original",
        },
        {
          id: "javascript-combine",
          source: "javascript",
          target: "combine",
          sourceHandle: "result",
          targetHandle: "normalized",
        },
      ],
    }
    const context = createContext({
      resultPromise: null as Promise<{ outputs: Record<string, unknown> }> | null,
      completions: [] as Array<{ output?: { outputs?: Record<string, unknown> } }>,
    })

    new Script(`
      ${createTestableWorkflowRuntime(manifest)}
      const env = {
        C0_WORKFLOW_ACTIONS: {
          recordWorkflowEvent: async () => ({ ok: true }),
          completeWorkflowRun: async (result) => {
            completions.push(result);
            return { ok: true };
          },
        },
      };
      const step = {
        do: async (...args) => args[args.length - 1](),
      };
      const workflow = new TenantWorkflow();
      workflow.env = env;
      resultPromise = workflow.run({
        payload: {
          workflowId: "wf_1",
          runId: "run_1",
          userId: "user_1",
          trigger: {
            kind: "manual",
            nodeId: "manual",
            payload: { value: 42 },
          },
        },
        timestamp: new Date("2026-01-01T00:00:00.000Z"),
      }, step);
    `).runInContext(context)

    const result = await context.resultPromise

    expect(result?.outputs.combine).toEqual({
      object: {
        original: { value: 42 },
        normalized: { ok: true, value: 42 },
        missing: null,
      },
    })
    expect(context.completions[0]?.output?.outputs?.combine).toEqual(result?.outputs.combine)
  })

  it("uses manually configured input values when an input is not connected", async () => {
    const manifest: WorkflowManifest = {
      version: WORKFLOW_MANIFEST_VERSION,
      name: "Manual input",
      nodes: [
        {
          id: "manual",
          type: "manual-trigger",
          label: "Manual",
          position: { x: 80, y: 140 },
          options: {},
        },
        {
          id: "javascript",
          type: "javascript",
          label: "JavaScript",
          position: { x: 360, y: 140 },
          options: {
            inputValues: { payload: "hardcoded" },
            code: "return inputs.payload",
          },
        },
      ],
      edges: [],
    }
    const context = createContext({
      resultPromise: null as Promise<{ outputs: Record<string, unknown> }> | null,
    })

    new Script(`
      ${createTestableWorkflowRuntime(manifest)}
      const env = {
        C0_WORKFLOW_ACTIONS: {
          recordWorkflowEvent: async () => ({ ok: true }),
          completeWorkflowRun: async () => ({ ok: true }),
        },
      };
      const step = {
        do: async (...args) => args[args.length - 1](),
      };
      const workflow = new TenantWorkflow();
      workflow.env = env;
      resultPromise = workflow.run({
        payload: {
          workflowId: "wf_1",
          runId: "run_1",
          userId: "user_1",
          trigger: {
            kind: "manual",
            nodeId: "manual",
            payload: {},
          },
        },
        timestamp: new Date("2026-01-01T00:00:00.000Z"),
      }, step);
    `).runInContext(context)

    const result = await context.resultPromise

    expect(result?.outputs.javascript).toEqual({ result: "hardcoded" })
  })

  it("disposes workflow action RPC call results without calling reserved dup", async () => {
    const context = createContext({
      resultPromise: null as Promise<{ outputs: Record<string, unknown> }> | null,
      events: [] as Array<{ eventType: string; nodeId?: string }>,
      completions: [] as unknown[],
      dupCount: 0,
      resultDisposeCount: 0,
      bindingDisposeCount: 0,
    })

    new Script(`
      ${createTestableWorkflowRuntime(defaultManifest())}
      function disposableResult(result) {
        return {
          ...result,
          dispose: () => {
            resultDisposeCount += 1;
          },
        };
      }
      const env = {
        C0_WORKFLOW_ACTIONS: {
          dup: () => {
            dupCount += 1;
            throw new Error("'dup' is a reserved method and cannot be called over RPC.");
          },
          dispose: () => {
            bindingDisposeCount += 1;
          },
          recordWorkflowEvent: async (event) => {
            events.push(event);
            return disposableResult({ ok: true });
          },
          completeWorkflowRun: async (result) => {
            completions.push(result);
            return disposableResult({ ok: true });
          },
          executeWorkflowNode: async () =>
            disposableResult({ outputs: { output: "done", status: "completed" } }),
        },
      };
      const step = {
        do: async (...args) => args[args.length - 1](),
      };
      const workflow = new TenantWorkflow();
      workflow.env = env;
      resultPromise = workflow.run({
        payload: {
          workflowId: "wf_1",
          runId: "run_1",
          userId: "user_1",
          trigger: {
            kind: "webhook",
            payload: { body: { message: "hello" }, headers: {}, query: {} },
          },
        },
        timestamp: new Date("2026-01-01T00:00:00.000Z"),
      }, step);
    `).runInContext(context)

    await context.resultPromise

    expect(context.dupCount).toBe(0)
    expect(context.resultDisposeCount).toBeGreaterThan(0)
    expect(context.bindingDisposeCount).toBe(1)
    expect(context.completions).toHaveLength(1)
  })

  it("only activates the selected trigger branch", async () => {
    const manifest: WorkflowManifest = {
      version: WORKFLOW_MANIFEST_VERSION,
      name: "Multi-trigger workflow",
      nodes: [
        {
          id: "manual",
          type: "manual-trigger",
          label: "Manual",
          position: { x: 80, y: 100 },
          options: {},
        },
        {
          id: "manualAction",
          type: "javascript",
          label: "Manual action",
          position: { x: 320, y: 100 },
          options: {
            code: 'return { branch: "manual", input: inputs.payload }',
          },
        },
        {
          id: "webhook",
          type: "webhook-trigger",
          label: "Webhook",
          position: { x: 80, y: 260 },
          options: {},
        },
        {
          id: "webhookAction",
          type: "javascript",
          label: "Webhook action",
          position: { x: 320, y: 260 },
          options: {
            code: 'return { branch: "webhook", input: inputs.payload }',
          },
        },
      ],
      edges: [
        {
          id: "manual-payload-action",
          source: "manual",
          target: "manualAction",
          sourceHandle: "payload",
          targetHandle: "payload",
        },
        {
          id: "webhook-body-action",
          source: "webhook",
          target: "webhookAction",
          sourceHandle: "body",
          targetHandle: "payload",
        },
      ],
    }
    const context = createContext({
      resultPromise: null as Promise<{ outputs: Record<string, unknown> }> | null,
      events: [] as Array<{ eventType: string; nodeId?: string }>,
      completions: [] as unknown[],
    })

    new Script(`
      ${createTestableWorkflowRuntime(manifest)}
      const env = {
        C0_WORKFLOW_ACTIONS: {
          recordWorkflowEvent: async (event) => {
            events.push(event);
            return { ok: true };
          },
          completeWorkflowRun: async (result) => {
            completions.push(result);
            return { ok: true };
          },
        },
      };
      const step = {
        do: async (...args) => args[args.length - 1](),
      };
      const workflow = new TenantWorkflow();
      workflow.env = env;
      resultPromise = workflow.run({
        payload: {
          workflowId: "wf_1",
          runId: "run_1",
          userId: "user_1",
          trigger: {
            kind: "manual",
            nodeId: "manual",
            payload: { message: "hello" },
          },
        },
        timestamp: new Date("2026-01-01T00:00:00.000Z"),
      }, step);
    `).runInContext(context)

    const result = await context.resultPromise

    expect(result?.outputs).toMatchObject({
      manual: {
        payload: { message: "hello" },
      },
      manualAction: {
        result: {
          branch: "manual",
          input: { message: "hello" },
        },
      },
      webhookAction: {},
    })
    expect(result?.outputs).not.toHaveProperty("webhook")
    expect(context.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "node_skipped",
          nodeId: "webhookAction",
        }),
      ]),
    )
  })

  it("pauses user approval nodes until an approval event arrives", async () => {
    const manifest: WorkflowManifest = {
      version: WORKFLOW_MANIFEST_VERSION,
      name: "Approval workflow",
      nodes: [
        {
          id: "manual",
          type: "manual-trigger",
          label: "Manual",
          position: { x: 80, y: 100 },
          options: {},
        },
        {
          id: "approval",
          type: "user-approval",
          label: "Approval",
          position: { x: 320, y: 100 },
          options: {
            message: "Approve deploy",
            timeout: "1 day",
          },
        },
      ],
      edges: [
        {
          id: "manual-approval",
          source: "manual",
          target: "approval",
          sourceHandle: "payload",
          targetHandle: "context",
        },
      ],
    }
    const context = createContext({
      resultPromise: null as Promise<{ outputs: Record<string, unknown> }> | null,
      events: [] as Array<{ eventType: string; nodeId?: string; data?: Record<string, unknown> }>,
      completions: [] as unknown[],
      waitEvents: [] as Array<{ name: string; options: Record<string, unknown> }>,
    })

    new Script(`
      ${createTestableWorkflowRuntime(manifest)}
      const env = {
        C0_WORKFLOW_ACTIONS: {
          recordWorkflowEvent: async (event) => {
            events.push(event);
            return { ok: true };
          },
          completeWorkflowRun: async (result) => {
            completions.push(result);
            return { ok: true };
          },
        },
      };
      const step = {
        do: async (...args) => args[args.length - 1](),
        waitForEvent: async (name, options) => {
          waitEvents.push({ name, options });
          return {
            type: options.type,
            timestamp: new Date("2026-01-01T00:01:00.000Z"),
            payload: {
              approved: true,
              comment: "ship it",
              approvedBy: "user_1",
              approvedAt: "2026-01-01T00:01:00.000Z",
            },
          };
        },
      };
      const workflow = new TenantWorkflow();
      workflow.env = env;
      resultPromise = workflow.run({
        payload: {
          workflowId: "wf_1",
          runId: "run_1",
          userId: "user_1",
          trigger: {
            kind: "manual",
            nodeId: "manual",
            payload: { deploy: true },
          },
        },
        timestamp: new Date("2026-01-01T00:00:00.000Z"),
      }, step);
    `).runInContext(context)

    const result = await context.resultPromise

    expect(context.waitEvents).toEqual([
      {
        name: "approval:approval",
        options: {
          type: "workflow-approval:wf_1:run_1:approval",
          timeout: "1 day",
        },
      },
    ])
    expect(context.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "approval_requested",
          nodeId: "approval",
          data: expect.objectContaining({
            approvalEventType: "workflow-approval:wf_1:run_1:approval",
          }),
        }),
      ]),
    )
    expect(result?.outputs.approval).toMatchObject({
      approved: true,
      decision: "approved",
      comment: "ship it",
      approvedBy: "user_1",
    })
  })

  it("pauses sleep nodes with a durable step sleep and passes the input through", async () => {
    const manifest: WorkflowManifest = {
      version: WORKFLOW_MANIFEST_VERSION,
      name: "Sleep workflow",
      nodes: [
        {
          id: "manual",
          type: "manual-trigger",
          label: "Manual",
          position: { x: 80, y: 100 },
          options: {},
        },
        {
          id: "wait",
          type: "sleep",
          label: "Wait",
          position: { x: 320, y: 100 },
          options: { duration: "5 minutes" },
        },
        {
          id: "fallbackWait",
          type: "sleep",
          label: "Fallback wait",
          position: { x: 560, y: 100 },
          options: { duration: "later" },
        },
      ],
      edges: [
        {
          id: "manual-wait",
          source: "manual",
          target: "wait",
          sourceHandle: "payload",
          targetHandle: "value",
        },
        {
          id: "wait-fallbackWait",
          source: "wait",
          target: "fallbackWait",
          sourceHandle: "value",
          targetHandle: "value",
        },
      ],
    }
    const context = createContext({
      resultPromise: null as Promise<{ outputs: Record<string, unknown> }> | null,
      events: [] as Array<{ eventType: string; nodeId?: string }>,
      completions: [] as unknown[],
      sleeps: [] as Array<{ name: string; duration: unknown }>,
    })

    new Script(`
      ${createTestableWorkflowRuntime(manifest)}
      const env = {
        C0_WORKFLOW_ACTIONS: {
          recordWorkflowEvent: async (event) => {
            events.push(event);
            return { ok: true };
          },
          completeWorkflowRun: async (result) => {
            completions.push(result);
            return { ok: true };
          },
        },
      };
      const step = {
        do: async (...args) => args[args.length - 1](),
        sleep: async (name, duration) => {
          sleeps.push({ name, duration });
        },
      };
      const workflow = new TenantWorkflow();
      workflow.env = env;
      resultPromise = workflow.run({
        payload: {
          workflowId: "wf_1",
          runId: "run_1",
          userId: "user_1",
          trigger: {
            kind: "manual",
            nodeId: "manual",
            payload: { alertId: "alert_1" },
          },
        },
        timestamp: new Date("2026-01-01T00:00:00.000Z"),
      }, step);
    `).runInContext(context)

    const result = await context.resultPromise

    expect(context.sleeps).toEqual([
      { name: "wait:sleep", duration: "5 minutes" },
      { name: "fallbackWait:sleep", duration: "5 minutes" },
    ])
    expect(result?.outputs.wait).toEqual({ value: { alertId: "alert_1" } })
    expect(result?.outputs.fallbackWait).toEqual({ value: { alertId: "alert_1" } })
    expect(context.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventType: "node_completed", nodeId: "wait" }),
      ]),
    )
  })

  it("redacts secret node values from persisted events and run output", async () => {
    const manifest: WorkflowManifest = {
      version: WORKFLOW_MANIFEST_VERSION,
      name: "Secret workflow",
      nodes: [
        {
          id: "manual",
          type: "manual-trigger",
          label: "Manual",
          position: { x: 80, y: 100 },
          options: {},
        },
        {
          id: "secret",
          type: "get-secret",
          label: "Get secret",
          position: { x: 320, y: 100 },
          options: { key: "API_TOKEN" },
        },
        {
          id: "slack",
          type: "slack-send-message",
          label: "Notify Slack",
          position: { x: 560, y: 100 },
          options: {
            channel: "C123",
            text: "Done",
          },
        },
        {
          id: "combine",
          type: "json-object",
          label: "JSON Object",
          position: { x: 560, y: 260 },
          options: {
            fields: ["token"],
          },
        },
      ],
      edges: [
        {
          id: "manual-secret",
          source: "manual",
          target: "secret",
          sourceHandle: "payload",
          targetHandle: "key",
        },
        {
          id: "secret-slack",
          source: "secret",
          target: "slack",
          sourceHandle: "value",
          targetHandle: "token",
        },
        {
          id: "secret-combine",
          source: "secret",
          target: "combine",
          sourceHandle: "value",
          targetHandle: "token",
        },
      ],
    }
    const context = createContext({
      resultPromise: null as Promise<{ outputs: Record<string, unknown> }> | null,
      events: [] as Array<{ eventType: string; nodeId?: string; data?: Record<string, unknown> }>,
      completions: [] as Array<{ output?: { outputs?: Record<string, unknown> } }>,
    })

    new Script(`
      ${createTestableWorkflowRuntime(manifest)}
      const env = {
        C0_WORKFLOW_ACTIONS: {
          recordWorkflowEvent: async (event) => {
            events.push(event);
            return { ok: true };
          },
          completeWorkflowRun: async (result) => {
            completions.push(result);
            return { ok: true };
          },
          executeWorkflowNode: async (input) => input.node.id === "slack"
            ? {
                outputs: {
                  ok: true,
                  channel: "C123",
                  ts: "123.456",
                },
              }
            : {
                outputs: {
                  found: true,
                  key: "API_TOKEN",
                  value: "super-secret",
                },
              },
        },
      };
      const step = {
        do: async (...args) => args[args.length - 1](),
      };
      const workflow = new TenantWorkflow();
      workflow.env = env;
      resultPromise = workflow.run({
        payload: {
          workflowId: "wf_1",
          runId: "run_1",
          userId: "user_1",
          trigger: {
            kind: "manual",
            nodeId: "manual",
            payload: { key: "API_TOKEN" },
          },
        },
        timestamp: new Date("2026-01-01T00:00:00.000Z"),
      }, step);
    `).runInContext(context)

    const result = await context.resultPromise
    const completedEvent = context.events.find(
      (event) => event.eventType === "node_completed" && event.nodeId === "secret",
    )
    const slackStartedEvent = context.events.find(
      (event) => event.eventType === "node_started" && event.nodeId === "slack",
    )

    expect(result?.outputs.secret).toMatchObject({
      found: true,
      key: "API_TOKEN",
      value: "[redacted]",
    })
    expect(completedEvent?.data?.result).toMatchObject({
      outputs: {
        value: "[redacted]",
      },
    })
    expect(context.completions[0]?.output?.outputs?.secret).toMatchObject({
      value: "[redacted]",
    })
    expect(result?.outputs.combine).toMatchObject({
      object: {
        token: "[redacted]",
      },
    })
    expect(slackStartedEvent?.data?.inputs).toMatchObject({
      token: "[redacted]",
    })
    expect(JSON.stringify(context.events)).not.toContain("super-secret")
    expect(JSON.stringify(context.completions)).not.toContain("super-secret")
  })

  it("compiles if/else nodes with branch skipping support", () => {
    const manifest = defaultManifest()
    manifest.nodes.splice(1, 0, {
      id: "branch",
      type: "if-else",
      label: "If / Else",
      position: { x: 220, y: 140 },
      options: {
        conditionExpression: "input.message != null",
      },
    })
    manifest.edges = [
      {
        id: "webhook-body-branch",
        source: "webhook",
        target: "branch",
        sourceHandle: "body",
        targetHandle: "value",
      },
      {
        id: "branch-true-javascript",
        source: "branch",
        target: "javascript",
        sourceHandle: "true",
        targetHandle: "payload",
      },
      {
        id: "javascript-result-isolate",
        source: "javascript",
        target: "isolate",
        sourceHandle: "result",
        targetHandle: "context",
      },
    ]

    const code = compileWorkflowToJavaScript(manifest)

    expect(code).toContain('node.type === "if-else"')
    expect(code).toContain("normalizeIfElseResult")
    expect(code).toContain("evaluateCelExpression")
    expect(code).toContain('"conditionExpression": "input.message != null"')
    expect(code).toContain("KERNEL.shouldRunNode(node.id, context.outputs, context.skippedNodeIds)")
    expect(code).toContain('eventType: "node_skipped"')
    expect(code).toContain('"sourceHandle": "true"')
  })

  it("evaluates generated if/else CEL expressions", () => {
    const manifest = defaultManifest()
    manifest.nodes.splice(1, 0, {
      id: "branch",
      type: "if-else",
      label: "If / Else",
      position: { x: 220, y: 140 },
      options: {
        conditionExpression:
          'input.score >= 0.8 && state.customer.tier == "gold" && state.emails.all(email, email.contains("@"))',
      },
    })

    const context = createContext({
      result: null,
    })
    new Script(`
      ${createTestableWorkflowRuntime(manifest)}
      result = evaluateCelExpression(
        ${JSON.stringify(String(manifest.nodes[1]?.options.conditionExpression))},
        {
          input: { score: 0.91 },
          state: {
            customer: { tier: "gold" },
            emails: ["pat@example.com", "sam@example.com"],
          },
          workflow: { input_as_text: "{}" },
        }
      );
    `).runInContext(context)

    expect(context.result).toBe(true)
  })

  it("still rejects cycles between action nodes", () => {
    const manifest = defaultManifest()
    manifest.edges.push({
      id: "isolate-status-javascript",
      source: "isolate",
      target: "javascript",
      sourceHandle: "status",
      targetHandle: "payload",
    })

    expect(() => compileWorkflowToJavaScript(manifest)).toThrow(
      "Workflow graph contains a cycle between action nodes",
    )
  })
})
