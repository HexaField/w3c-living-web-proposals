/**
 * Flow extension — mixed into Context.prototype at install time.
 *
 * Methods exposed on Context:
 *   addFlow(name, flowJson)
 *   removeFlow(name)
 *   getFlows()
 *   getFlowState(flowName, instanceUri)
 *   executeFlowTransition(flowName, instanceUri, transitionName)
 *   availableTransitions(flowName, instanceUri)
 */

import { Context } from '@living-web/personal-graph';
import {
  FLOW,
  flowActionKind,
  type FlowDefinition,
  type FlowInfo,
  type FlowTransitionResult,
} from './types.js';
import { parseISODuration } from './duration.js';

const registries = new WeakMap<Context, Map<string, FlowDefinition>>();

function getRegistry(ctx: Context): Map<string, FlowDefinition> {
  let r = registries.get(ctx);
  if (!r) {
    r = new Map();
    registries.set(ctx, r);
  }
  return r;
}

async function addFlow(this: Context, name: string, flowJson: string): Promise<void> {
  const def = JSON.parse(flowJson) as FlowDefinition;
  if (!def.name || !def.initialState || !Array.isArray(def.states) || !Array.isArray(def.transitions)) {
    throw new DOMException('Invalid flow definition', 'SyntaxError');
  }
  const reg = getRegistry(this);
  if (reg.has(name)) throw new DOMException(`Flow "${name}" already exists`, 'ConstraintError');

  const flowUri = def.namespace + def.name;
  await this.addTriple({ subject: this.did, predicate: FLOW.HAS_FLOW, object: flowUri });
  await this.addTriple({ subject: flowUri, predicate: 'rdf://type', object: FLOW.TYPE });
  await this.addTriple({ subject: flowUri, predicate: FLOW.NAME, object: `"${def.name}"` });
  await this.addTriple({ subject: flowUri, predicate: FLOW.APPLIES_TO, object: def.appliesTo });
  await this.addTriple({ subject: flowUri, predicate: FLOW.INITIAL_STATE, object: `"${def.initialState}"` });
  for (const s of def.states) {
    const stateUri = `${flowUri}/state/${s.name}`;
    await this.addTriple({ subject: flowUri, predicate: FLOW.HAS_STATE, object: stateUri });
    await this.addTriple({ subject: stateUri, predicate: FLOW.STATE_NAME, object: `"${s.name}"` });
    if (s.isTerminal) {
      await this.addTriple({ subject: stateUri, predicate: FLOW.IS_TERMINAL, object: '"true"' });
    }
  }
  for (const t of def.transitions) {
    const tUri = `${flowUri}/transition/${t.name}`;
    await this.addTriple({ subject: flowUri, predicate: FLOW.HAS_TRANSITION, object: tUri });
    await this.addTriple({ subject: tUri, predicate: FLOW.TRANSITION_NAME, object: `"${t.name}"` });
    await this.addTriple({ subject: tUri, predicate: FLOW.TRANSITION_FROM, object: `"${t.fromState}"` });
    await this.addTriple({ subject: tUri, predicate: FLOW.TRANSITION_TO, object: `"${t.toState}"` });
    if (t.guard) {
      await this.addTriple({ subject: tUri, predicate: FLOW.TRANSITION_GUARD, object: `"${t.guard.replace(/"/g, '\\"')}"` });
    }
    if (t.guardDescription) {
      await this.addTriple({ subject: tUri, predicate: FLOW.TRANSITION_GUARD_DESC, object: `"${t.guardDescription}"` });
    }
    if (t.temporal?.minDelay) {
      await this.addTriple({ subject: tUri, predicate: FLOW.TRANSITION_MIN_DELAY, object: `"${t.temporal.minDelay}"` });
    }
    if (t.temporal?.maxDelay) {
      await this.addTriple({ subject: tUri, predicate: FLOW.TRANSITION_MAX_DELAY, object: `"${t.temporal.maxDelay}"` });
    }
    if (t.temporal?.onDeadline) {
      await this.addTriple({ subject: tUri, predicate: FLOW.TRANSITION_ON_DEADLINE, object: `"${t.temporal.onDeadline}"` });
    }
    if (t.role) {
      await this.addTriple({ subject: tUri, predicate: FLOW.TRANSITION_ROLE, object: `"${t.role}"` });
    }
  }

  reg.set(name, def);
}

async function removeFlow(this: Context, name: string): Promise<void> {
  const reg = getRegistry(this);
  const def = reg.get(name);
  if (!def) return;
  const flowUri = def.namespace + def.name;
  const link = await this.queryTriples({ subject: this.did, predicate: FLOW.HAS_FLOW, object: flowUri });
  for (const t of link) await this.removeTriple(t);
  reg.delete(name);
}

async function getFlows(this: Context): Promise<FlowInfo[]> {
  const reg = getRegistry(this);
  return [...reg.values()].map(def => ({
    name: def.name,
    appliesTo: def.appliesTo,
    initialState: def.initialState,
    states: def.states.map(s => s.name),
    transitions: def.transitions.map(t => t.name),
  }));
}

async function getFlowState(this: Context, flowName: string, instanceUri: string): Promise<string> {
  const reg = getRegistry(this);
  const def = reg.get(flowName);
  if (!def) throw new TypeError(`Flow "${flowName}" not found`);
  const triples = await this.queryTriples({ subject: instanceUri, predicate: FLOW.STATE });
  if (triples.length === 0) return def.initialState;
  return triples[0].data.object.replace(/^"|"$/g, '');
}

async function executeFlowTransition(
  this: Context,
  flowName: string,
  instanceUri: string,
  transitionName: string,
): Promise<FlowTransitionResult> {
  const reg = getRegistry(this);
  const def = reg.get(flowName);
  if (!def) return { success: false, reason: `Flow "${flowName}" not found` };
  const transition = def.transitions.find(t => t.name === transitionName);
  if (!transition) return { success: false, reason: `Transition "${transitionName}" not found` };

  const currentState = await getFlowState.call(this, flowName, instanceUri);
  if (currentState !== transition.fromState) {
    return { success: false, reason: `Instance is in state "${currentState}", not "${transition.fromState}"` };
  }

  // Temporal check
  if (transition.temporal?.minDelay) {
    const stateTriples = await this.queryTriples({ subject: instanceUri, predicate: FLOW.STATE });
    const enteredAt = stateTriples[0]?.timestamp;
    if (enteredAt) {
      const elapsed = Date.now() - new Date(enteredAt).getTime();
      const minMs = parseISODuration(transition.temporal.minDelay);
      if (elapsed < minMs) {
        return {
          success: false,
          reason: `Cannot transition: must wait at least ${transition.temporal.minDelay}`,
          guardDescription: transition.guardDescription,
          secondsUntilAllowed: Math.ceil((minMs - elapsed) / 1000),
        };
      }
    }
  }

  // Guard check
  if (transition.guard) {
    const query = transition.guard.replace(/\$this/g, `<${instanceUri}>`);
    try {
      const result = await this.querySparql(query);
      if (result.boolean === false) {
        return {
          success: false,
          reason: transition.guardDescription ?? 'Guard failed',
          guardDescription: transition.guardDescription,
        };
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { success: false, reason: `Guard evaluation failed: ${msg}` };
    }
  }

  // Apply the transition.
  const existing = await this.queryTriples({ subject: instanceUri, predicate: FLOW.STATE });
  for (const e of existing) await this.removeTriple(e);
  await this.addTriple({ subject: instanceUri, predicate: FLOW.STATE, object: `"${transition.toState}"` });
  if (transition.actions) {
    for (const action of transition.actions) {
      const kind = flowActionKind(action.type);
      const subject = action.subject === 'this' ? instanceUri : action.subject;
      const object = action.object === 'now' ? new Date().toISOString() : action.object;
      if (kind === 'setSingleTarget') {
        const ex = await this.queryTriples({ subject, predicate: action.predicate });
        for (const e of ex) await this.removeTriple(e);
        await this.addTriple({ subject, predicate: action.predicate, object });
      } else if (kind === 'addLink') {
        await this.addTriple({ subject, predicate: action.predicate, object });
      } else {
        // removeLink
        const ex = await this.queryTriples({ subject, predicate: action.predicate, object });
        for (const e of ex) await this.removeTriple(e);
      }
    }
  }
  this.dispatchEvent(new Event('transitionfired'));
  return { success: true, newState: transition.toState };
}

async function availableTransitions(this: Context, flowName: string, instanceUri: string): Promise<string[]> {
  const reg = getRegistry(this);
  const def = reg.get(flowName);
  if (!def) return [];
  const currentState = await getFlowState.call(this, flowName, instanceUri);
  const candidates = def.transitions.filter(t => t.fromState === currentState);
  const available: string[] = [];
  for (const t of candidates) {
    let ok = true;
    if (t.guard) {
      try {
        const r = await this.querySparql(t.guard.replace(/\$this/g, `<${instanceUri}>`));
        ok = r.boolean !== false;
      } catch { ok = false; }
    }
    if (ok) available.push(t.name);
  }
  return available;
}

declare module '@living-web/personal-graph' {
  interface Context {
    addFlow(name: string, flowJson: string): Promise<void>;
    removeFlow(name: string): Promise<void>;
    getFlows(): Promise<FlowInfo[]>;
    getFlowState(flowName: string, instanceUri: string): Promise<string>;
    executeFlowTransition(
      flowName: string,
      instanceUri: string,
      transitionName: string,
    ): Promise<FlowTransitionResult>;
    availableTransitions(flowName: string, instanceUri: string): Promise<string[]>;
  }
}

export function installFlowExtension(): void {
  const proto = Context.prototype as Context;
  if (typeof proto.addFlow === 'function') return;
  Object.assign(Context.prototype, {
    addFlow,
    removeFlow,
    getFlows,
    getFlowState,
    executeFlowTransition,
    availableTransitions,
  });
}
