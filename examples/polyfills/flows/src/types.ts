/**
 * Flow primitive types.
 */

export interface FlowDefinition {
  name: string;
  namespace: string;
  appliesTo: string;
  initialState: string;
  states: StateDefinition[];
  transitions: TransitionDefinition[];
}

export interface StateDefinition {
  name: string;
  displayName?: string;
  isTerminal?: boolean;
}

export interface TransitionDefinition {
  name: string;
  displayName?: string;
  fromState: string;
  toState: string;
  guard?: string;
  guardDescription?: string;
  temporal?: TemporalConstraint;
  role?: string;
  actions?: FlowAction[];
  triggersSubFlow?: string;
}

export interface TemporalConstraint {
  /** ISO 8601 duration (e.g., "PT48H"). */
  minDelay?: string;
  maxDelay?: string;
  onDeadline?: 'auto-transition' | 'error-state' | 'notify';
}

export type FlowActionType =
  | 'flow://actions/addLink'
  | 'flow://actions/setSingleTarget'
  | 'flow://actions/removeLink';

export interface FlowAction {
  type: FlowActionType;
  /** "this" — the FlowInstance — or a static URI. */
  subject: string;
  predicate: string;
  /** Static URI/literal, or `"now"` (current timestamp), or `"agent"` (firing agent DID). */
  object: string;
}

export interface FlowTransitionResult {
  success: boolean;
  newState?: string;
  reason?: string;
  guardDescription?: string;
  secondsUntilAllowed?: number;
}

export interface FlowInfo {
  name: string;
  appliesTo: string;
  initialState: string;
  states: string[];
  transitions: string[];
}

/** Canonical predicates for storing flows as triples. */
export const FLOW = {
  HAS_FLOW: 'flow://has_flow',
  TYPE: 'flow://Flow',
  NAME: 'flow://name',
  APPLIES_TO: 'flow://applies_to',
  INITIAL_STATE: 'flow://initial_state',
  HAS_STATE: 'flow://has_state',
  STATE_NAME: 'flow://state_name',
  IS_TERMINAL: 'flow://is_terminal',
  HAS_TRANSITION: 'flow://has_transition',
  TRANSITION_NAME: 'flow://transition_name',
  TRANSITION_FROM: 'flow://transition_from',
  TRANSITION_TO: 'flow://transition_to',
  TRANSITION_GUARD: 'flow://transition_guard',
  TRANSITION_GUARD_DESC: 'flow://transition_guard_description',
  TRANSITION_MIN_DELAY: 'flow://transition_min_delay',
  TRANSITION_MAX_DELAY: 'flow://transition_max_delay',
  TRANSITION_ON_DEADLINE: 'flow://transition_on_deadline',
  TRANSITION_ROLE: 'flow://transition_role',
  /** On a FlowInstance: current state. */
  STATE: 'flow://state',
  COMPLETED: 'flow://completed',
} as const;

export function flowActionKind(action: FlowActionType): 'addLink' | 'setSingleTarget' | 'removeLink' {
  if (!action.startsWith('flow://actions/')) {
    throw new TypeError(`Flow action must be a flow://actions/ URI, got: ${action}`);
  }
  const kind = action.slice('flow://actions/'.length);
  if (kind !== 'addLink' && kind !== 'setSingleTarget' && kind !== 'removeLink') {
    throw new TypeError(`Unknown flow action kind: ${kind}`);
  }
  return kind;
}
