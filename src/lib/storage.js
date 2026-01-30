/**
 * Storage utilities for YouTube Playlist Backup
 * Uses chrome.storage.local for persistent data storage
 */

/**
 * Get all data from storage
 * @returns {Promise<Object>} All stored data
 */
export async function getAllData() {
  return chrome.storage.local.get(null);
}

/**
 * Get all playlists from storage
 * @returns {Promise<Object>} Playlists object keyed by playlistId
 */
export async function getPlaylists() {
  const data = await chrome.storage.local.get('playlists');
  return data.playlists || {};
}

/**
 * Get a single playlist by ID
 * @param {string} playlistId - Playlist ID
 * @returns {Promise<Object|null>} Playlist object or null
 */
export async function getPlaylist(playlistId) {
  const playlists = await getPlaylists();
  return playlists[playlistId] || null;
}

/**
 * Save or update a playlist
 * @param {Object} playlist - Playlist object with playlistId
 * @returns {Promise<void>}
 */
export async function savePlaylist(playlist) {
  const playlists = await getPlaylists();
  playlists[playlist.playlistId] = playlist;
  await chrome.storage.local.set({ playlists });
}

/**
 * Delete a playlist from storage
 * @param {string} playlistId - Playlist ID to delete
 * @returns {Promise<void>}
 */
export async function deletePlaylist(playlistId) {
  const playlists = await getPlaylists();
  delete playlists[playlistId];
  await chrome.storage.local.set({ playlists });
}

/**
 * Get monitored playlists only
 * @returns {Promise<Object[]>} Array of monitored playlist objects
 */
export async function getMonitoredPlaylists() {
  const playlists = await getPlaylists();
  return Object.values(playlists).filter(p => p.monitored);
}
