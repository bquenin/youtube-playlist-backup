/**
 * Test setup - Chrome API mocks
 */

// In-memory storage for tests
let mockStorage = {};

// Mock Chrome APIs
globalThis.chrome = {
  storage: {
    local: {
      get: async (keys) => {
        if (keys === null) {
          return { ...mockStorage };
        }
        if (typeof keys === 'string') {
          return { [keys]: mockStorage[keys] };
        }
        if (Array.isArray(keys)) {
          const result = {};
          for (const key of keys) {
            if (key in mockStorage) {
              result[key] = mockStorage[key];
            }
          }
          return result;
        }
        return {};
      },
      set: async (items) => {
        Object.assign(mockStorage, items);
      },
      remove: async (keys) => {
        const keysArray = Array.isArray(keys) ? keys : [keys];
        for (const key of keysArray) {
          delete mockStorage[key];
        }
      },
      clear: async () => {
        mockStorage = {};
      }
    }
  },
  runtime: {
    lastError: null,
    sendMessage: async () => ({}),
    onMessage: {
      addListener: () => {}
    },
    onInstalled: {
      addListener: () => {}
    }
  },
  action: {
    setBadgeText: () => {},
    setBadgeBackgroundColor: () => {}
  },
  notifications: {
    create: () => {}
  },
  identity: {
    getRedirectURL: () => 'https://fake-redirect.chromiumapp.org/',
    launchWebAuthFlow: () => {}
  }
};

// Helper to reset storage between tests
export function resetMockStorage() {
  mockStorage = {};
}

// Helper to set mock storage data
export function setMockStorage(data) {
  mockStorage = { ...data };
}

// Helper to get current mock storage
export function getMockStorage() {
  return { ...mockStorage };
}
