/** Message types between content script, popup, and service worker */

export interface CreateIdentityMessage {
  type: 'CREATE_IDENTITY';
  displayName: string;
}

export interface GetIdentityMessage {
  type: 'GET_IDENTITY';
}

export interface GetStatusMessage {
  type: 'GET_STATUS';
}

export interface IdentityResponse {
  type: 'IDENTITY';
  did: string | null;
  displayName: string | null;
}

export interface GraphInfo {
  name: string;
  tripleCount: number;
}

export interface SharedGraphInfo {
  name: string;
  peerCount: number;
  syncState: string;
}

export interface StatusResponse {
  type: 'STATUS';
  identity: { did: string; displayName: string } | null;
  graphs: GraphInfo[];
  sharedGraphs: SharedGraphInfo[];
  active: boolean;
}

export type ExtensionMessage =
  | CreateIdentityMessage
  | GetIdentityMessage
  | GetStatusMessage;

export type ExtensionResponse =
  | IdentityResponse
  | StatusResponse;
