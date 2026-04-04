/**
 * Governance setup for collaborative canvas
 */
import { SharedGraph } from '@living-web/graph-sync';
import {
  createGovernanceLayer,
  createCapability,
  delegateCapability,
  type ZCAPDocument,
} from '@living-web/governance';
import { PREDICATES } from './shapes.js';

const EDITOR_PREDICATES = [
  PREDICATES.SHAPE_TYPE, PREDICATES.SHAPE_X, PREDICATES.SHAPE_Y,
  PREDICATES.SHAPE_W, PREDICATES.SHAPE_H, PREDICATES.SHAPE_RADIUS,
  PREDICATES.SHAPE_X2, PREDICATES.SHAPE_Y2,
  PREDICATES.SHAPE_FILL, PREDICATES.SHAPE_STROKE, PREDICATES.SHAPE_STROKE_W,
  PREDICATES.SHAPE_TEXT, PREDICATES.SHAPE_FONT_SIZE, PREDICATES.SHAPE_AUTHOR,
  PREDICATES.PATH_DATA, PREDICATES.PATH_STROKE, PREDICATES.PATH_STROKE_W,
  PREDICATES.PATH_FILL, PREDICATES.PATH_AUTHOR,
  PREDICATES.HAS_SHAPE, PREDICATES.ENTRY_TYPE,
];

const OWNER_PREDICATES = [
  ...EDITOR_PREDICATES,
  PREDICATES.CANVAS_NAME, PREDICATES.CANVAS_OWNER, PREDICATES.CANVAS_BG,
  PREDICATES.LAYER_NAME, PREDICATES.LAYER_ORDER, PREDICATES.LAYER_VISIBLE,
  PREDICATES.LAYER_LOCKED, PREDICATES.HAS_LAYER, PREDICATES.HAS_CHILD,
  PREDICATES.COLLAB_DID, PREDICATES.COLLAB_NAME, PREDICATES.COLLAB_ROLE,
  PREDICATES.COLLAB_COLOR,
];

export interface GovernanceState {
  layer: ReturnType<typeof createGovernanceLayer>;
  rootZcap: ZCAPDocument;
  zcaps: Map<string, ZCAPDocument>;
  lockedLayers: Set<string>;
}

export function setupGovernance(graph: SharedGraph, ownerDid: string): GovernanceState {
  const layer = createGovernanceLayer(graph, { rootAuthority: ownerDid });
  const rootZcap = createCapability(
    ownerDid, OWNER_PREDICATES,
    { within: null, graph: graph.uri },
    ownerDid,
  );
  layer.storeExpression(rootZcap.id, rootZcap);

  return {
    layer,
    rootZcap,
    zcaps: new Map([[ownerDid, rootZcap]]),
    lockedLayers: new Set(),
  };
}

export function issueEditorZcap(
  state: GovernanceState, editorDid: string, ownerDid: string,
): ZCAPDocument {
  const zcap = delegateCapability(
    state.rootZcap, editorDid, ownerDid,
    { subsetPredicates: EDITOR_PREDICATES },
  );
  state.layer.storeExpression(zcap.id, zcap);
  state.zcaps.set(editorDid, zcap);
  return zcap;
}

export interface ValidationResult {
  allowed: boolean;
  reason?: string;
}

export function validateShapeAction(
  state: GovernanceState, did: string, layerId: string, isOwner: boolean,
): ValidationResult {
  if (isOwner) return { allowed: true };
  if (!state.zcaps.has(did)) return { allowed: false, reason: 'View only: you need editor access' };
  if (state.lockedLayers.has(layerId)) return { allowed: false, reason: 'Layer is locked' };
  return { allowed: true };
}
