/**
 * YouTube Data API v3 wrapper
 * Handles authentication and API calls for playlist operations
 * Uses launchWebAuthFlow for dynamic OAuth client ID support
 */

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';
const OAUTH_SCOPES = 'https://www.googleapis.com/auth/youtube.readonly';
const REDIRECT_URL = chrome.identity.getRedirectURL();

// Embedded OAuth Client ID - users don't need to configure this
const CLIENT_ID = '1073429581282-k8bq902m4v3h7kmm1uk70innuuhl1j01.apps.googleusercontent.com';

/**
 * Get stored access token
 * @returns {Promise<string|null>} Access token or null
 */
async function getStoredToken() {
  const data = await chrome.storage.local.get(['accessToken', 'tokenExpiry']);
  if (data.accessToken && data.tokenExpiry && Date.now() < data.tokenExpiry) {
    return data.accessToken;
  }
  return null;
}

/**
 * Store access token
 * @param {string} token - Access token
 * @param {number} expiresIn - Seconds until expiry
 */
async function storeToken(token, expiresIn = 3600) {
  await chrome.storage.local.set({
    accessToken: token,
    tokenExpiry: Date.now() + (expiresIn * 1000) - 60000 // 1 min buffer
  });
}

/**
 * Clear stored token
 */
async function clearStoredToken() {
  await chrome.storage.local.remove(['accessToken', 'tokenExpiry']);
}

/**
 * Get client ID (embedded)
 * @returns {string} Client ID
 */
function getClientId() {
  return CLIENT_ID;
}

/**
 * Get OAuth access token using launchWebAuthFlow
 * @param {boolean} interactive - Whether to show interactive login prompt
 * @returns {Promise<string>} Access token
 */
export async function getAuthToken(interactive = false) {
  // First check for stored valid token
  const storedToken = await getStoredToken();
  if (storedToken) {
    return storedToken;
  }

  if (!interactive) {
    throw new Error('No valid token and interactive mode disabled');
  }

  // Get client ID
  const clientId = getClientId();

  // Build OAuth URL
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', REDIRECT_URL);
  authUrl.searchParams.set('response_type', 'token');
  authUrl.searchParams.set('scope', OAUTH_SCOPES);
  authUrl.searchParams.set('prompt', 'consent');

  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow(
      { url: authUrl.toString(), interactive: true },
      (redirectUrl) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (!redirectUrl) {
          reject(new Error('No redirect URL received'));
          return;
        }

        // Parse the access token from the redirect URL
        const url = new URL(redirectUrl);
        const hashParams = new URLSearchParams(url.hash.substring(1));
        const accessToken = hashParams.get('access_token');
        const expiresIn = parseInt(hashParams.get('expires_in') || '3600');

        if (!accessToken) {
          reject(new Error('No access token in response'));
          return;
        }

        // Store the token
        storeToken(accessToken, expiresIn).then(() => {
          resolve(accessToken);
        });
      }
    );
  });
}

/**
 * Check if user is authenticated
 * @returns {Promise<boolean>}
 */
export async function isAuthenticated() {
  try {
    const token = await getStoredToken();
    return !!token;
  } catch {
    return false;
  }
}

/**
 * Sign in user (interactive)
 * @returns {Promise<string>} Access token
 */
export async function signIn() {
  return getAuthToken(true);
}

/**
 * Sign out user
 * @returns {Promise<void>}
 */
export async function signOut() {
  try {
    const token = await getStoredToken();
    if (token) {
      // Revoke the token on Google's servers
      await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`);
    }
  } catch {
    // Ignore errors during sign out
  }
  await clearStoredToken();
}

/**
 * Make authenticated API request
 * @param {string} endpoint - API endpoint (without base URL)
 * @param {Object} params - Query parameters
 * @returns {Promise<Object>} API response
 */
async function apiRequest(endpoint, params = {}) {
  let token = await getStoredToken();

  if (!token) {
    throw new Error('Not authenticated. Please sign in.');
  }

  const url = new URL(`${YOUTUBE_API_BASE}${endpoint}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.append(key, value);
    }
  });

  const response = await fetch(url.toString(), {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json'
    }
  });

  if (response.status === 401) {
    // Token expired, clear it and throw error
    await clearStoredToken();
    throw new Error('Session expired. Please sign in again.');
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || `API request failed: ${response.status}`);
  }

  return response.json();
}

/**
 * Fetch user's playlists
 * @param {string} pageToken - Pagination token (optional)
 * @returns {Promise<Object>} Playlists response
 */
export async function fetchUserPlaylists(pageToken = null) {
  return apiRequest('/playlists', {
    part: 'snippet,contentDetails',
    mine: true,
    maxResults: 50,
    pageToken
  });
}

/**
 * Fetch all user's playlists (handles pagination)
 * @returns {Promise<Object[]>} Array of playlist objects
 */
export async function fetchAllUserPlaylists() {
  const playlists = [];
  let pageToken = null;

  do {
    const response = await fetchUserPlaylists(pageToken);

    for (const item of response.items || []) {
      playlists.push({
        playlistId: item.id,
        title: item.snippet.title,
        description: item.snippet.description,
        thumbnailUrl: item.snippet.thumbnails?.medium?.url ||
                      item.snippet.thumbnails?.default?.url || '',
        itemCount: item.contentDetails.itemCount,
        publishedAt: item.snippet.publishedAt
      });
    }

    pageToken = response.nextPageToken;
  } while (pageToken);

  return playlists;
}

/**
 * Fetch items in a playlist
 * @param {string} playlistId - Playlist ID
 * @param {string} pageToken - Pagination token (optional)
 * @returns {Promise<Object>} Playlist items response
 */
export async function fetchPlaylistItems(playlistId, pageToken = null) {
  return apiRequest('/playlistItems', {
    part: 'snippet,contentDetails,status',
    playlistId,
    maxResults: 50,
    pageToken
  });
}

/**
 * Fetch all items in a playlist (handles pagination)
 * @param {string} playlistId - Playlist ID
 * @returns {Promise<Object[]>} Array of video objects
 */
export async function fetchAllPlaylistItems(playlistId) {
  const videos = [];
  let pageToken = null;

  do {
    const response = await fetchPlaylistItems(playlistId, pageToken);

    for (const item of response.items || []) {
      const snippet = item.snippet;

      // Detect unavailable videos by various indicators
      const title = snippet.title || '';
      const isUnavailable =
        title === 'Deleted video' ||
        title === 'Private video' ||
        !snippet.videoOwnerChannelTitle ||  // Missing channel info
        !snippet.thumbnails;                 // No thumbnails at all

      videos.push({
        videoId: snippet.resourceId.videoId,
        title: title,
        description: snippet.description,
        channelTitle: snippet.videoOwnerChannelTitle || '',
        channelId: snippet.videoOwnerChannelId || '',
        thumbnailUrl: snippet.thumbnails?.medium?.url ||
                      snippet.thumbnails?.default?.url || '',
        position: snippet.position,
        addedAt: snippet.publishedAt,
        isUnavailable
      });
    }

    pageToken = response.nextPageToken;
  } while (pageToken);

  return videos;
}

/**
 * Fetch playlist metadata
 * @param {string} playlistId - Playlist ID
 * @returns {Promise<Object>} Playlist metadata
 */
export async function fetchPlaylistMetadata(playlistId) {
  const response = await apiRequest('/playlists', {
    part: 'snippet,contentDetails',
    id: playlistId
  });

  if (!response.items || response.items.length === 0) {
    throw new Error(`Playlist ${playlistId} not found`);
  }

  const item = response.items[0];
  return {
    playlistId: item.id,
    title: item.snippet.title,
    description: item.snippet.description,
    thumbnailUrl: item.snippet.thumbnails?.medium?.url ||
                  item.snippet.thumbnails?.default?.url || '',
    itemCount: item.contentDetails.itemCount,
    publishedAt: item.snippet.publishedAt
  };
}

/**
 * Create a snapshot of a playlist
 * @param {string} playlistId - Playlist ID
 * @returns {Promise<Object>} Snapshot object with videos
 */
export async function createPlaylistSnapshot(playlistId) {
  const videos = await fetchAllPlaylistItems(playlistId);

  return {
    capturedAt: Date.now(),
    videos
  };
}
