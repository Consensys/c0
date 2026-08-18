import {
  isWorkflowActionNodeType,
  isWorkflowTriggerNodeType,
  type WorkflowManifest,
  type WorkflowManifestNode,
} from "@c0-agent/shared"
import { stringifyJson } from "../../lib/json"
import {
  CURRENT_WORKFLOW_RUNTIME_ABI_VERSION,
  getWorkflowRuntimeKernelModuleName,
} from "./runtime-abi"
import * as Arr from "effect/Array"
import * as Match from "effect/Match"
import * as Option from "effect/Option"

function isActionConnectingEdge(
  nodeById: Map<string, WorkflowManifestNode>,
  edge: { source: string; target: string },
): boolean {
  const source = nodeById.get(edge.source)
  const target = nodeById.get(edge.target)
  return Boolean(
    source &&
    target &&
    !isWorkflowTriggerNodeType(source.type) &&
    !isWorkflowTriggerNodeType(target.type),
  )
}

function topologicalActionNodes(manifest: WorkflowManifest): WorkflowManifestNode[] {
  const nodeById = new Map(manifest.nodes.map((node) => [node.id, node]))
  const actionNodes = Arr.filter(manifest.nodes, (node) => isWorkflowActionNodeType(node.type))
  const inDegree = new Map(actionNodes.map((node) => [node.id, 0]))
  const outgoing = new Map<string, string[]>()

  Arr.forEach(
    Arr.filter(manifest.edges, (edge) => isActionConnectingEdge(nodeById, edge)),
    (edge) => {
      inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1)
      const current = outgoing.get(edge.source) ?? []
      outgoing.set(edge.source, [...current, edge.target])
    },
  )

  const queue = Arr.filter(actionNodes, (node) => (inDegree.get(node.id) ?? 0) === 0)
  const ordered: WorkflowManifestNode[] = []

  const enqueueIfReady = (targetId: string): void => {
    const target = nodeById.get(targetId)
    Match.value(Boolean(target && isWorkflowActionNodeType(target.type))).pipe(
      Match.when(true, () => {
        queue.push(target as WorkflowManifestNode)
      }),
      Match.orElse(() => undefined),
    )
  }

  const reduceDegree = (targetId: string): void => {
    const nextDegree = (inDegree.get(targetId) ?? 0) - 1
    inDegree.set(targetId, nextDegree)
    Match.value(nextDegree === 0).pipe(
      Match.when(true, () => enqueueIfReady(targetId)),
      Match.orElse(() => undefined),
    )
  }

  // Kahn's algorithm worklist expressed as recursion to keep the topological ordering identical
  // while avoiding an imperative `while` loop over the mutable queue.
  function drainQueue(): void {
    Option.match(Option.fromNullishOr(queue.shift()), {
      onNone: () => undefined,
      onSome: (node) => {
        ordered.push(node)
        Arr.forEach(outgoing.get(node.id) ?? [], (targetId) => reduceDegree(targetId))
        drainQueue()
      },
    })
  }

  drainQueue()

  Match.value(ordered.length !== actionNodes.length).pipe(
    Match.when(true, () => {
      throw new Error("Workflow graph contains a cycle between action nodes")
    }),
    Match.orElse(() => undefined),
  )

  return ordered
}

function buildJavascriptHandler(node: WorkflowManifestNode, javascriptIndex: number): string {
  const functionName = `javascriptNode${javascriptIndex}`
  const code = Match.value(
    typeof node.options.code === "string" && node.options.code.trim().length > 0,
  ).pipe(
    Match.when(true, () => node.options.code as string),
    Match.orElse(() => "return inputs.payload ?? null"),
  )

  return `
async function ${functionName}(inputs, context) {
${code}
}`
}

function createInlineActionHandlers(manifest: WorkflowManifest): string {
  const javascriptNodes = Arr.filter(manifest.nodes, (node) => node.type === "javascript")
  const javascriptHandlers = Arr.map(javascriptNodes, (node, javascriptIndex) =>
    buildJavascriptHandler(node, javascriptIndex),
  )
  const javascriptCases = Arr.map(
    javascriptNodes,
    (node, javascriptIndex) =>
      `case ${stringifyJson(node.id)}: return normalizeActionResult(await javascriptNode${javascriptIndex}(inputs, context));`,
  )

  return `
${javascriptHandlers.join("\n")}

async function runJavaScriptNode(node, inputs, context) {
  switch (node.id) {
    ${javascriptCases.join("\n    ")}
    default:
      throw new Error("No JavaScript handler compiled for node " + node.id);
  }
}
`
}

const CEL_RUNTIME_SOURCE = String.raw`
function createCelSyntaxError(source, token, message) {
  const index = token ? token.index : source.length;
  return new Error(message + " at character " + index);
}

function tokenizeCelExpression(source) {
  const tokens = [];
  let index = 0;

  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (char === '"' || char === "'") {
      const quote = char;
      const start = index;
      index += 1;
      let value = "";
      while (index < source.length) {
        const current = source[index];
        if (current === quote) {
          index += 1;
          tokens.push({ type: "string", value, index: start });
          break;
        }
        if (current === "\\") {
          const next = source[index + 1];
          if (next === undefined) {
            throw createCelSyntaxError(source, { index }, "Unterminated escape sequence");
          }
          value += next === "n" ? "\n" : next === "t" ? "\t" : next === "r" ? "\r" : next;
          index += 2;
          continue;
        }
        value += current;
        index += 1;
      }
      if (tokens[tokens.length - 1]?.index !== start) {
        throw createCelSyntaxError(source, { index: start }, "Unterminated string");
      }
      continue;
    }

    if (/[0-9]/.test(char)) {
      const start = index;
      while (/[0-9]/.test(source[index] ?? "")) {
        index += 1;
      }
      if (source[index] === ".") {
        index += 1;
        while (/[0-9]/.test(source[index] ?? "")) {
          index += 1;
        }
      }
      tokens.push({ type: "number", value: Number(source.slice(start, index)), index: start });
      continue;
    }

    if (/[A-Za-z_]/.test(char)) {
      const start = index;
      while (/[A-Za-z0-9_]/.test(source[index] ?? "")) {
        index += 1;
      }
      const value = source.slice(start, index);
      tokens.push({ type: value === "in" ? "operator" : "identifier", value, index: start });
      continue;
    }

    const two = source.slice(index, index + 2);
    if (["==", "!=", ">=", "<=", "&&", "||"].includes(two)) {
      tokens.push({ type: "operator", value: two, index });
      index += 2;
      continue;
    }

    if ("()[]{}.,?:+-*/%!<>".includes(char)) {
      tokens.push({ type: "operator", value: char, index });
      index += 1;
      continue;
    }

    throw createCelSyntaxError(source, { index }, "Unexpected token");
  }

  tokens.push({ type: "eof", value: "", index: source.length });
  return tokens;
}

function parseCelExpression(source) {
  const tokens = tokenizeCelExpression(source);
  let position = 0;

  function peek() {
    return tokens[position];
  }

  function match(value) {
    if (peek().value !== value) {
      return false;
    }
    position += 1;
    return true;
  }

  function expect(value, message) {
    const token = peek();
    if (token.value !== value) {
      throw createCelSyntaxError(source, token, message);
    }
    position += 1;
    return token;
  }

  function expectIdentifier(message) {
    const token = peek();
    if (token.type !== "identifier") {
      throw createCelSyntaxError(source, token, message);
    }
    position += 1;
    return token;
  }

  function parseArguments() {
    const args = [];
    if (match(")")) {
      return args;
    }
    do {
      args.push(parseConditional());
    } while (match(","));
    expect(")", "Expected closing parenthesis");
    return args;
  }

  function parsePrimary() {
    const token = peek();
    if (token.type === "number" || token.type === "string") {
      position += 1;
      return { type: "literal", value: token.value };
    }
    if (token.type === "identifier") {
      position += 1;
      if (token.value === "true") {
        return { type: "literal", value: true };
      }
      if (token.value === "false") {
        return { type: "literal", value: false };
      }
      if (token.value === "null") {
        return { type: "literal", value: null };
      }
      return { type: "identifier", name: token.value };
    }
    if (match("(")) {
      const expression = parseConditional();
      expect(")", "Expected closing parenthesis");
      return expression;
    }
    throw createCelSyntaxError(source, token, "Expected expression");
  }

  function parsePostfix() {
    let expression = parsePrimary();
    for (;;) {
      if (match(".")) {
        const property = expectIdentifier("Expected property name").value;
        if (match("(")) {
          expression = {
            type: "call",
            callee: { type: "member", object: expression, property },
            args: parseArguments(),
          };
        } else {
          expression = { type: "member", object: expression, property };
        }
        continue;
      }
      if (match("[")) {
        const index = parseConditional();
        expect("]", "Expected closing bracket");
        expression = { type: "index", object: expression, index };
        continue;
      }
      if (match("(")) {
        expression = { type: "call", callee: expression, args: parseArguments() };
        continue;
      }
      return expression;
    }
  }

  function parseUnary() {
    if (match("!") || match("-")) {
      const operator = tokens[position - 1].value;
      return { type: "unary", operator, argument: parseUnary() };
    }
    return parsePostfix();
  }

  function parseBinary(parseNext, operators) {
    let expression = parseNext();
    while (operators.includes(peek().value)) {
      const operator = peek().value;
      position += 1;
      expression = { type: "binary", operator, left: expression, right: parseNext() };
    }
    return expression;
  }

  function parseMultiplicative() {
    return parseBinary(parseUnary, ["*", "/", "%"]);
  }

  function parseAdditive() {
    return parseBinary(parseMultiplicative, ["+", "-"]);
  }

  function parseRelational() {
    return parseBinary(parseAdditive, ["<", "<=", ">", ">=", "in"]);
  }

  function parseEquality() {
    return parseBinary(parseRelational, ["==", "!="]);
  }

  function parseAnd() {
    return parseBinary(parseEquality, ["&&"]);
  }

  function parseOr() {
    return parseBinary(parseAnd, ["||"]);
  }

  function parseConditional() {
    const condition = parseOr();
    if (!match("?")) {
      return condition;
    }
    const consequent = parseConditional();
    expect(":", "Expected ':' in conditional expression");
    const alternate = parseConditional();
    return { type: "conditional", condition, consequent, alternate };
  }

  const expression = parseConditional();
  if (peek().type !== "eof") {
    throw createCelSyntaxError(source, peek(), "Unexpected token");
  }
  return expression;
}

function celTruthy(value) {
  return Boolean(value);
}

function celEqual(left, right) {
  return left === right;
}

function celCompare(left, right, operator) {
  if (operator === "<") return left < right;
  if (operator === "<=") return left <= right;
  if (operator === ">") return left > right;
  if (operator === ">=") return left >= right;
  return false;
}

function celIn(value, collection) {
  if (Array.isArray(collection)) {
    return collection.includes(value);
  }
  if (typeof collection === "string") {
    return collection.includes(String(value));
  }
  if (collection && typeof collection === "object") {
    return Object.prototype.hasOwnProperty.call(collection, String(value));
  }
  return false;
}

function celSize(value) {
  if (Array.isArray(value) || typeof value === "string") {
    return value.length;
  }
  if (value && typeof value === "object") {
    return Object.keys(value).length;
  }
  return 0;
}

function celGetMember(value, property) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "object" || typeof value === "string") {
    const record = Object(value);
    return Object.prototype.hasOwnProperty.call(record, property) ? record[property] : null;
  }
  return null;
}

function celApplyFunction(name, args) {
  if (name === "size") {
    return celSize(args[0]);
  }
  if (name === "has") {
    return args[0] !== null && args[0] !== undefined;
  }
  if (name === "string") {
    return args[0] === null || args[0] === undefined ? "" : String(args[0]);
  }
  if (name === "int") {
    return Math.trunc(Number(args[0] ?? 0));
  }
  if (name === "double") {
    return Number(args[0] ?? 0);
  }
  if (name === "bool") {
    return Boolean(args[0]);
  }
  throw new Error("Unsupported CEL function '" + name + "'");
}

function celApplyMethod(target, name, args) {
  if (name === "contains") {
    if (typeof target === "string") {
      return target.includes(String(args[0]));
    }
    if (Array.isArray(target)) {
      return target.includes(args[0]);
    }
    return false;
  }
  if (name === "startsWith") {
    return typeof target === "string" && target.startsWith(String(args[0]));
  }
  if (name === "endsWith") {
    return typeof target === "string" && target.endsWith(String(args[0]));
  }
  if (name === "matches") {
    return typeof target === "string" && new RegExp(String(args[0])).test(target);
  }
  throw new Error("Unsupported CEL method '" + name + "'");
}

function evaluateCelAst(node, scope) {
  if (node.type === "literal") {
    return node.value;
  }
  if (node.type === "identifier") {
    return Object.prototype.hasOwnProperty.call(scope, node.name) ? scope[node.name] : null;
  }
  if (node.type === "member") {
    return celGetMember(evaluateCelAst(node.object, scope), node.property);
  }
  if (node.type === "index") {
    const target = evaluateCelAst(node.object, scope);
    const index = evaluateCelAst(node.index, scope);
    if (target === null || target === undefined) {
      return null;
    }
    return Object(target)[index] ?? null;
  }
  if (node.type === "unary") {
    const value = evaluateCelAst(node.argument, scope);
    return node.operator === "!" ? !celTruthy(value) : -Number(value ?? 0);
  }
  if (node.type === "conditional") {
    return celTruthy(evaluateCelAst(node.condition, scope))
      ? evaluateCelAst(node.consequent, scope)
      : evaluateCelAst(node.alternate, scope);
  }
  if (node.type === "binary") {
    if (node.operator === "&&") {
      return celTruthy(evaluateCelAst(node.left, scope)) && celTruthy(evaluateCelAst(node.right, scope));
    }
    if (node.operator === "||") {
      return celTruthy(evaluateCelAst(node.left, scope)) || celTruthy(evaluateCelAst(node.right, scope));
    }
    const left = evaluateCelAst(node.left, scope);
    const right = evaluateCelAst(node.right, scope);
    if (node.operator === "==") return celEqual(left, right);
    if (node.operator === "!=") return !celEqual(left, right);
    if (node.operator === "in") return celIn(left, right);
    if (["<", "<=", ">", ">="].includes(node.operator)) return celCompare(left, right, node.operator);
    if (node.operator === "+") return typeof left === "string" || typeof right === "string" ? String(left ?? "") + String(right ?? "") : Number(left ?? 0) + Number(right ?? 0);
    if (node.operator === "-") return Number(left ?? 0) - Number(right ?? 0);
    if (node.operator === "*") return Number(left ?? 0) * Number(right ?? 0);
    if (node.operator === "/") return Number(left ?? 0) / Number(right ?? 0);
    if (node.operator === "%") return Number(left ?? 0) % Number(right ?? 0);
  }
  if (node.type === "call") {
    if (node.callee.type === "identifier") {
      return celApplyFunction(node.callee.name, node.args.map((arg) => evaluateCelAst(arg, scope)));
    }
    if (node.callee.type === "member") {
      const target = evaluateCelAst(node.callee.object, scope);
      const name = node.callee.property;
      if (name === "all" || name === "exists") {
        const binding = node.args[0];
        const expression = node.args[1];
        if (!binding || binding.type !== "identifier" || !expression) {
          throw new Error("CEL macro '" + name + "' expects a variable and expression");
        }
        const values = Array.isArray(target) ? target : [];
        if (name === "all") {
          return values.every((value) => evaluateCelAst(expression, { ...scope, [binding.name]: value }));
        }
        return values.some((value) => evaluateCelAst(expression, { ...scope, [binding.name]: value }));
      }
      return celApplyMethod(target, name, node.args.map((arg) => evaluateCelAst(arg, scope)));
    }
  }
  throw new Error("Unsupported CEL expression");
}

function evaluateCelExpression(expression, scope) {
  return evaluateCelAst(parseCelExpression(expression), scope);
}

function createCelActivation(inputs, context) {
  const input = Object.prototype.hasOwnProperty.call(inputs, "value")
    ? inputs.value
    : Object.prototype.hasOwnProperty.call(inputs, "input")
      ? inputs.input
      : inputs;
  return {
    input,
    state: context.state ?? {},
    workflow: {
      id: context.workflowId,
      runId: context.runId,
    },
  };
}
`

export function compileWorkflowToJavaScript(manifest: WorkflowManifest): string {
  const actionOrder = topologicalActionNodes(manifest).map((node) => node.id)
  const runtimeAbiVersion = CURRENT_WORKFLOW_RUNTIME_ABI_VERSION
  const runtimeKernelModuleName = getWorkflowRuntimeKernelModuleName(runtimeAbiVersion)

  return `import { WorkflowEntrypoint } from "cloudflare:workers";
import { createWorkflowRuntimeKernel, normalizeActionResult } from "./${runtimeKernelModuleName}";

const WORKFLOW_RUNTIME_ABI_VERSION = ${runtimeAbiVersion};
const MANIFEST = ${
    // oxlint-disable-next-line effect/avoid-direct-json -- Emits the manifest into the compiled workflow ABI artifact with exact 2-space pretty-printing; the sanctioned `stringifyJson` helper is compact and would change persisted artifact bytes and the runtime ABI fingerprint.
    JSON.stringify(manifest, null, 2)
  };
const ACTION_ORDER = ${
    // oxlint-disable-next-line effect/avoid-direct-json -- Emits the action order into the compiled workflow ABI artifact with exact 2-space pretty-printing; the sanctioned `stringifyJson` helper is compact and would change persisted artifact bytes and the runtime ABI fingerprint.
    JSON.stringify(actionOrder, null, 2)
  };
const KERNEL = createWorkflowRuntimeKernel(MANIFEST);
const NODE_BY_ID = new Map(MANIFEST.nodes.map((node) => [node.id, node]));
const ACTION_STEP_CONFIG = { timeout: "30 minutes" };
const DEFAULT_IF_ELSE_EXPRESSION = "input != null";

${createInlineActionHandlers(manifest)}
${CEL_RUNTIME_SOURCE}

function getMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function redactTriggerForEvent(trigger) {
  if (!trigger || trigger.kind !== "slack" || !trigger.payload || typeof trigger.payload !== "object") {
    return trigger;
  }
  return {
    ...trigger,
    payload: {
      ...trigger.payload,
      ...(Object.prototype.hasOwnProperty.call(trigger.payload, "responseUrl") ? { responseUrl: "[redacted]" } : {}),
    },
  };
}

function normalizeIfElseResult(result, inputs) {
  const value = Object.prototype.hasOwnProperty.call(inputs, "value") ? inputs.value : inputs.input;
  if (Boolean(result)) {
    return { outputs: { condition: true, true: value } };
  }
  return { outputs: { condition: false, false: value } };
}

function getJsonObjectFields(node) {
  const fields = Array.isArray(node.options.fields) ? node.options.fields : ["value"];
  const uniqueFields = [];
  const seen = new Set();
  for (const field of fields) {
    const key = typeof field === "string" ? field.trim() : "";
    if (!key || seen.has(key)) {
      continue;
    }
    uniqueFields.push(key);
    seen.add(key);
  }
  return uniqueFields;
}

function runJsonObjectNode(node, inputs) {
  const object = {};
  for (const field of getJsonObjectFields(node)) {
    object[field] = Object.prototype.hasOwnProperty.call(inputs, field) ? inputs[field] : null;
  }
  return { outputs: { object } };
}

function getIfElseExpression(node) {
  return typeof node.options.conditionExpression === "string" && node.options.conditionExpression.trim()
    ? node.options.conditionExpression
    : DEFAULT_IF_ELSE_EXPRESSION;
}

const SLEEP_DURATION_PATTERN = /^\\s*[1-9]\\d*\\s*(?:second|minute|hour|day|week|month|year)s?\\s*$/i;
const DEFAULT_SLEEP_DURATION = "5 minutes";

function getSleepDuration(node) {
  const duration = node.options.duration;
  if (typeof duration === "number" && Number.isInteger(duration) && duration > 0) {
    return duration;
  }
  if (typeof duration === "string" && SLEEP_DURATION_PATTERN.test(duration)) {
    return duration.trim();
  }
  return DEFAULT_SLEEP_DURATION;
}

async function runSleepNode(step, node, inputs) {
  await step.sleep(node.id + ":sleep", getSleepDuration(node));
  const value = Object.prototype.hasOwnProperty.call(inputs, "value") ? inputs.value : null;
  return { outputs: { value } };
}

function getApprovalEventType(context, node) {
  return "workflow-approval:" + context.workflowId + ":" + context.runId + ":" + node.id;
}

function getApprovalTimeout(node) {
  return typeof node.options.timeout === "string" && node.options.timeout.trim()
    ? node.options.timeout
    : "7 days";
}

function getApprovalMessage(node) {
  return typeof node.options.message === "string" && node.options.message.trim()
    ? node.options.message
    : node.label + " is waiting for approval.";
}

function normalizeApprovalResult(event) {
  const payload = event && typeof event.payload === "object" && event.payload !== null
    ? event.payload
    : {};
  const decision = payload.approved === true || payload.decision === "approved" ? "approved" : "rejected";
  const approvedAt = typeof payload.approvedAt === "string" && payload.approvedAt
    ? payload.approvedAt
    : event?.timestamp?.toISOString?.() ?? new Date().toISOString();
  return {
    outputs: {
      approved: decision === "approved",
      decision,
      comment: typeof payload.comment === "string" ? payload.comment : "",
      approvedBy: typeof payload.approvedBy === "string" ? payload.approvedBy : "",
      approvedAt,
      payload,
    },
  };
}

async function waitForApprovalNode(env, step, node, inputs, context) {
  const approvalEventType = getApprovalEventType(context, node);
  await record(env, {
    workflowId: context.workflowId,
    runId: context.runId,
    nodeId: node.id,
    eventType: "approval_requested",
    message: node.label + " requested approval",
    data: {
      nodeType: node.type,
      approvalEventType,
      message: getApprovalMessage(node),
      timeout: getApprovalTimeout(node),
      inputs: KERNEL.redactInputsForEvent(node.id, inputs),
      userId: context.userId,
    },
  }, context);
  const event = await step.waitForEvent(node.id + ":approval", {
    type: approvalEventType,
    timeout: getApprovalTimeout(node),
  });
  return normalizeApprovalResult(event);
}

function disposeRpcValue(value) {
  if (!value || typeof value !== "object") {
    return;
  }
  if (typeof value.dispose === "function") {
    value.dispose();
    return;
  }
  if (typeof Symbol !== "undefined" && Symbol.dispose && typeof value[Symbol.dispose] === "function") {
    value[Symbol.dispose]();
  }
}

function safeDisposeRpcValue(value) {
  try {
    disposeRpcValue(value);
  } catch {
    // Disposing RPC stubs is best-effort cleanup and should not mask workflow results.
  }
}

async function withWorkflowActions(env, invoke) {
  const result = await invoke(env.C0_WORKFLOW_ACTIONS);
  safeDisposeRpcValue(result);
  return result;
}

function createActionContext(context) {
  return {
    workflowId: context.workflowId,
    runId: context.runId,
    userId: context.userId,
    oktaUserId: context.oktaUserId,
    state: context.state,
  };
}

async function record(env, event, context) {
  await withWorkflowActions(env, (actions) =>
    actions.recordWorkflowEvent({
      ...event,
      userId: context.userId,
      ...(context.oktaUserId ? { oktaUserId: context.oktaUserId } : {}),
    })
  );
  return true;
}

async function complete(env, result) {
  await withWorkflowActions(env, (actions) => actions.completeWorkflowRun(result));
  return true;
}

async function executeNode(env, node, inputs, trigger, context) {
  if (node.type === "javascript") {
    return runJavaScriptNode(node, inputs, createActionContext(context));
  }
  if (node.type === "if-else") {
    return normalizeIfElseResult(
      evaluateCelExpression(getIfElseExpression(node), createCelActivation(inputs, context)),
      inputs
    );
  }
  if (node.type === "json-object") {
    return runJsonObjectNode(node, inputs);
  }
  return withWorkflowActions(env, (actions) =>
    actions.executeWorkflowNode({
      workflowId: context.workflowId,
      runId: context.runId,
      manifestVersion: MANIFEST.version,
      node,
      inputs,
      trigger,
      userId: context.userId,
      oktaUserId: context.oktaUserId,
    })
  );
}

export class TenantWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const params = event.payload ?? {};
    const workflowId = params.workflowId;
    const runId = params.runId;
    const trigger = params.trigger ?? { kind: "manual", payload: {} };
    const userId =
      typeof params.userId === "string" && params.userId
        ? params.userId
        : null;
    if (!userId) {
      throw new Error("Dynamic workflow params must include userId");
    }
    const oktaUserId =
      typeof params.oktaUserId === "string" && params.oktaUserId ? params.oktaUserId : null;
    const context = {
      workflowId,
      runId,
      userId,
      oktaUserId,
      trigger,
      outputs: KERNEL.createInitialOutputs(trigger, event.timestamp?.toISOString?.() ?? null),
      state: {},
      skippedNodeIds: new Set(),
    };
    let currentNode = null;

    try {
      try {
        await step.do("run:event:started", async () =>
          record(this.env, {
            workflowId,
            runId,
            eventType: "run_started",
            message: "Workflow run started",
            data: { trigger: redactTriggerForEvent(trigger), userId },
          }, context)
        );

        for (const nodeId of ACTION_ORDER) {
          const node = NODE_BY_ID.get(nodeId);
          if (!node) {
            continue;
          }
          if (!KERNEL.shouldRunNode(node.id, context.outputs, context.skippedNodeIds)) {
            context.skippedNodeIds.add(node.id);
            context.outputs[node.id] = {};
            await step.do(node.id + ":event:skipped", async () =>
              record(this.env, {
                workflowId,
                runId,
                nodeId: node.id,
                eventType: "node_skipped",
                message: node.label + " skipped",
                data: { nodeType: node.type, userId },
              }, context)
            );
            continue;
          }
          const inputs = KERNEL.collectInputs(node.id, context.outputs);
          currentNode = node;
          await step.do(node.id + ":event:started", async () =>
            record(this.env, {
              workflowId,
              runId,
              nodeId: node.id,
              eventType: "node_started",
              message: node.label + " started",
              data: { nodeType: node.type, inputs: KERNEL.redactInputsForEvent(node.id, inputs), userId },
            }, context)
          );
          const result = node.type === "user-approval"
            ? await waitForApprovalNode(this.env, step, node, inputs, context)
            : node.type === "sleep"
              ? await runSleepNode(step, node, inputs)
              : await step.do(node.id + ":action", ACTION_STEP_CONFIG, async () =>
                  executeNode(this.env, node, inputs, trigger, context)
                );
          const normalized = normalizeActionResult(result);
          context.outputs[node.id] = normalized.outputs ?? {};
          await step.do(node.id + ":event:completed", async () =>
            record(this.env, {
              workflowId,
              runId,
              nodeId: node.id,
              eventType: "node_completed",
              message: node.label + " completed",
              data: { nodeType: node.type, result: KERNEL.redactActionResultForEvent(node, normalized), userId },
            }, context)
          );
          currentNode = null;
        }

        const output = { outputs: KERNEL.redactWorkflowOutputsForEvent(context.outputs) };
        await step.do("run:event:completed", async () =>
          record(this.env, {
            workflowId,
            runId,
            eventType: "run_completed",
            message: "Workflow run completed",
            data: { ...output, userId },
          }, context)
        );
        await step.do("run:complete", async () =>
          complete(this.env, {
            workflowId,
            runId,
            status: "completed",
            output,
          })
        );
        return output;
      } catch (error) {
        const message = getMessage(error);
        const failedNode = currentNode
          ? {
              nodeId: currentNode.id,
              nodeType: currentNode.type,
              nodeLabel: currentNode.label,
            }
          : {};
        await step.do("run:event:failed", async () =>
          record(this.env, {
            workflowId,
            runId,
            eventType: "run_failed",
            level: "error",
            message,
            data: { error: message, ...failedNode, userId },
          }, context)
        );
        await step.do("run:failed", async () =>
          complete(this.env, {
            workflowId,
            runId,
            status: "failed",
            error: message,
          })
        );
        throw error;
      }
    } finally {
      safeDisposeRpcValue(this.env?.C0_WORKFLOW_ACTIONS);
    }
  }
}
`
}
