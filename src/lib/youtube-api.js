/**
 * YouTube Data API v3 wrapper
 * Handles authentication and API calls for playlist operations
 * Uses chrome.identity.getAuthToken for automatic token management
 */

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';

/**
 * Get OAuth access token using Chrome's identity API
 * This automatically handles token caching and refresh
 * @param {boolean} interactive - Whether to show interactive login prompt
 * @returns {Promise<string>} Access token
 */
export async function getAuthToken(interactive = false) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!token) {
        reject(new Error('No token received'));
        return;
      }
      resolve(token);
    });
  });
}

/**
 * Check if user is authenticated
 * @returns {Promise<boolean>}
 */
export async function isAuthenticated() {
  try {
    await getAuthToken(false);
    return true;
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
  return new Promise((resolve) => {
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
      if (token) {
        // Revoke the token and remove from cache
        chrome.identity.removeCachedAuthToken({ token }, () => {
          fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`)
            .finally(() => resolve());
        });
      } else {
        resolve();
      }
    });
  });
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
