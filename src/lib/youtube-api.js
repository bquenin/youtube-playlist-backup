/**
 * YouTube Data API v3 wrapper
 * Handles authentication and API calls for playlist operations
 * Uses OAuth authorization code flow with PKCE and refresh tokens
 */

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';
const OAUTH_SCOPES = 'https://www.googleapis.com/auth/youtube.readonly';
const REDIRECT_URL = chrome.identity.getRedirectURL();
const CLIENT_ID = '1073429581282-t9m5cajkaom9e5s2mpp0opcgo72ffsok.apps.googleusercontent.com';
const CLIENT_SECRET = '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';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

/**
 * Generate random string for PKCE
 */
function generateRandomString(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  let result = '';
  const randomValues = crypto.getRandomValues(new Uint8Array(length));
  for (let i = 0; i < length; i++) {
    result += chars[randomValues[i] % chars.length];
  }
  return result;
}

/**
 * Generate PKCE code challenge from verifier
 */
async function generateCodeChallenge(verifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Get stored tokens
 */
async function getStoredTokens() {
  const data = await chrome.storage.local.get(['accessToken', 'refreshToken', 'tokenExpiry']);
  return data;
}

/**
 * Store tokens
 */
async function storeTokens(accessToken, refreshToken, expiresIn) {
  const data = { accessToken };
  if (refreshToken) {
    data.refreshToken = refreshToken;
  }
  if (expiresIn) {
    data.tokenExpiry = Date.now() + (expiresIn * 1000) - 60000; // 1 min buffer
  }
  await chrome.storage.local.set(data);
}

/**
 * Clear stored tokens
 */
async function clearTokens() {
  await chrome.storage.local.remove(['accessToken', 'refreshToken', 'tokenExpiry']);
}

/**
 * Refresh access token using refresh token
 */
async function refreshAccessToken(refreshToken) {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    })
  });

  if (!response.ok) {
    throw new Error('Failed to refresh token');
  }

  const tokens = await response.json();
  await storeTokens(tokens.access_token, null, tokens.expires_in);
  return tokens.access_token;
}

/**
 * Get valid access token (refreshes if needed)
 */
export async function getAuthToken(interactive = false) {
  const stored = await getStoredTokens();

  // Check if we have a valid access token
  if (stored.accessToken && stored.tokenExpiry && Date.now() < stored.tokenExpiry) {
    return stored.accessToken;
  }

  // Try to refresh if we have a refresh token
  if (stored.refreshToken) {
    try {
      return await refreshAccessToken(stored.refreshToken);
    } catch (error) {
      // Refresh failed, need to re-authenticate
      if (!interactive) {
        throw new Error('Token expired and refresh failed');
      }
    }
  }

  if (!interactive) {
    throw new Error('No valid token');
  }

  // Do interactive sign-in with PKCE
  const codeVerifier = generateRandomString(64);
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', REDIRECT_URL);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', OAUTH_SCOPES);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');

  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow(
      { url: authUrl.toString(), interactive: true },
      async (redirectUrl) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (!redirectUrl) {
          reject(new Error('No redirect URL received'));
          return;
        }

        // Extract authorization code
        const url = new URL(redirectUrl);
        const code = url.searchParams.get('code');

        if (!code) {
          reject(new Error('No authorization code received'));
          return;
        }

        // Exchange code for tokens
        try {
          const tokenResponse = await fetch(TOKEN_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_id: CLIENT_ID,
              client_secret: CLIENT_SECRET,
              code: code,
              code_verifier: codeVerifier,
              grant_type: 'authorization_code',
              redirect_uri: REDIRECT_URL
            })
          });

          if (!tokenResponse.ok) {
            const error = await tokenResponse.text();
            reject(new Error('Token exchange failed: ' + error));
            return;
          }

          const tokens = await tokenResponse.json();
          await storeTokens(tokens.access_token, tokens.refresh_token, tokens.expires_in);
          resolve(tokens.access_token);
        } catch (error) {
          reject(error);
        }
      }
    );
  });
}

/**
 * Check if user is authenticated
 */
export async function isAuthenticated() {
  try {
    const stored = await getStoredTokens();
    return !!stored.refreshToken;
  } catch {
    return false;
  }
}

/**
 * Sign in user (interactive)
 */
export async function signIn() {
  return getAuthToken(true);
}

/**
 * Sign out user
 */
export async function signOut() {
  const stored = await getStoredTokens();
  if (stored.accessToken) {
    try {
      await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${stored.accessToken}`);
    } catch {
      // Ignore revoke errors
    }
  }
  await clearTokens();
}

/**
 * Make authenticated API request
 * @param {string} endpoint - API endpoint (without base URL)
 * @param {Object} params - Query parameters
 * @returns {Promise<Object>} API response
 */
async function apiRequest(endpoint, params = {}) {
  let token = await getAuthToken(false);

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
    await clearTokens();
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
