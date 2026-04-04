/**
 * Living Web Extension — Service Worker (background)
 * Manages identity persistence and handles messages from content scripts and popup.
 */

import type { ExtensionMessage, StatusResponse } from './types.js';

// Identity state
let currentIdentity: { did: string; displayName: string } | null = null;

// Restore identity from storage on startup
chrome.storage.local.get(['livingWebIdentity'], (result) => {
  if (result.livingWebIdentity) {
    currentIdentity = result.livingWebIdentity;
    console.info('[Living Web SW] Restored identity:', currentIdentity?.did);
  }
});

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  switch (message.type) {
    case 'CREATE_IDENTITY': {
      // In a real implementation, this would coordinate with the content script's
      // IdentityManager. For now, we store a simple record.
      const identity = {
        did: `did:key:z${crypto.getRandomValues(new Uint8Array(32)).reduce((s, b) => s + b.toString(16).padStart(2, '0'), '')}`,
        displayName: message.displayName,
      };
      currentIdentity = identity;
      chrome.storage.local.set({ livingWebIdentity: identity });
      sendResponse({ type: 'IDENTITY', did: identity.did, displayName: identity.displayName });
      return true;
    }

    case 'GET_IDENTITY': {
      sendResponse({
        type: 'IDENTITY',
        did: currentIdentity?.did ?? null,
        displayName: currentIdentity?.displayName ?? null,
      });
      return true;
    }

    case 'GET_STATUS': {
      const status: StatusResponse = {
        type: 'STATUS',
        identity: currentIdentity,
        graphs: [],
        sharedGraphs: [],
        active: true,
      };
      sendResponse(status);
      return true;
    }
  }
});

console.info('[Living Web SW] Service worker started');
