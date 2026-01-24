/**
 * Background Service Worker
 * Handles scheduled syncs, API calls, and notifications
 */

import * as storage from '../lib/storage.js';
import * as youtubeApi from '../lib/youtube-api.js';
import { mergeVideos, countUnavailable } from '../lib/sync-utils.js';

const SYNC_ALARM_NAME = 'playlist-sync';

// Frequency to minutes mapping
const FREQUENCY_MINUTES = {
  daily: 60 * 24,
  weekly: 60 * 24 * 7
};

/**
 * Initialize the extension on install
 */
chrome.runtime.onInstalled.addListener(async () => {
  await setupSyncAlarm();
  await updateBadge();
});

/**
 * Handle alarm events
 */
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === SYNC_ALARM_NAME) {
    await syncAllPlaylists();
  }
});

/**
 * Set up the sync alarm based on settings
 */
async function setupSyncAlarm() {
  const settings = await storage.getSettings();
  const periodInMinutes = FREQUENCY_MINUTES[settings.syncFrequency] || FREQUENCY_MINUTES.daily;

  // Clear existing alarm
  await chrome.alarms.clear(SYNC_ALARM_NAME);

  // Create new alarm
  chrome.alarms.create(SYNC_ALARM_NAME, {
    periodInMinutes,
    delayInMinutes: 1 // First sync after 1 minute
  });
}

/**
 * Sync all monitored playlists
 * @returns {Promise<Object>} Sync results
 */
async function syncAllPlaylists() {
  const results = {
    synced: 0,
    unavailable: 0,
    errors: []
  };

  try {
    // Check if authenticated
    const isAuth = await youtubeApi.isAuthenticated();
    if (!isAuth) {
      return results;
    }

    const monitoredPlaylists = await storage.getMonitoredPlaylists();

    for (const playlist of monitoredPlaylists) {
      try {
        const syncResult = await syncPlaylist(playlist.playlistId);
        results.synced++;
        results.unavailable += syncResult.unavailableCount;
      } catch (error) {
        results.errors.push({
          playlistId: playlist.playlistId,
          error: error.message
        });
      }
    }

    // Show notification if there are unavailable videos
    if (results.unavailable > 0) {
      const settings = await storage.getSettings();
      if (settings.notifyOnRemoval) {
        await showRemovalNotification(results.unavailable);
      }
    }

    await updateBadge();
  } catch (error) {
    results.errors.push({ error: error.message });
  }

  return results;
}

/**
 * Sync a single playlist
 * @param {string} playlistId - Playlist ID to sync
 * @returns {Promise<Object>} Sync result
 */
async function syncPlaylist(playlistId) {
  // Get current playlist from storage
  let playlist = await storage.getPlaylist(playlistId);

  // Fetch fresh metadata
  const metadata = await youtubeApi.fetchPlaylistMetadata(playlistId);

  // Fetch current videos
  const newVideos = await youtubeApi.fetchAllPlaylistItems(playlistId);

  // Update playlist with metadata and videos
  if (!playlist) {
    playlist = {
      playlistId,
      ...metadata,
      monitored: true,
      videos: [],
      lastSyncedAt: null
    };
  } else {
    playlist = {
      ...playlist,
      ...metadata
    };
  }

  // Merge videos, preserving metadata for unavailable ones
  playlist.videos = mergeVideos(playlist.videos || [], newVideos);
  playlist.lastSyncedAt = Date.now();
  await storage.savePlaylist(playlist);

  return {
    unavailableCount: countUnavailable(playlist.videos),
    videoCount: playlist.videos.length
  };
}

/**
 * Show browser notification for unavailable videos
 * @param {number} count - Number of unavailable videos
 */
async function showRemovalNotification(count) {
  const message = count === 1
    ? '1 video became unavailable in your playlists'
    : `${count} videos became unavailable in your playlists`;

  chrome.notifications.create({
    type: 'basic',
    iconUrl: '/icons/icon128.png',
    title: 'YouTube Playlist Backup',
    message
  });
}

/**
 * Clear the badge
 */
async function updateBadge() {
  chrome.action.setBadgeText({ text: '' });
}

/**
 * Message handler for popup communication
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message).then(sendResponse);
  return true; // Keep channel open for async response
});

/**
 * Handle messages from popup
 * @param {Object} message - Message object
 * @returns {Promise<Object>} Response
 */
async function handleMessage(message) {
  switch (message.action) {
    case 'getAuthStatus':
      return { authenticated: await youtubeApi.isAuthenticated() };

    case 'signIn':
      try {
        await youtubeApi.signIn();
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }

    case 'signOut':
      await youtubeApi.signOut();
      return { success: true };

    case 'fetchPlaylists':
      try {
        const playlists = await youtubeApi.fetchAllUserPlaylists();
        return { success: true, playlists };
      } catch (error) {
        return { success: false, error: error.message };
      }

    case 'syncPlaylist':
      try {
        const result = await syncPlaylist(message.playlistId);
        await updateBadge();
        return { success: true, ...result };
      } catch (error) {
        return { success: false, error: error.message };
      }

    case 'syncAll':
      try {
        const results = await syncAllPlaylists();
        return { success: true, ...results };
      } catch (error) {
        return { success: false, error: error.message };
      }

    case 'getStoredPlaylists':
      try {
        const playlists = await storage.getPlaylists();
        return { success: true, playlists };
      } catch (error) {
        return { success: false, error: error.message };
      }

    case 'getMonitoredPlaylists':
      try {
        const playlists = await storage.getMonitoredPlaylists();
        return { success: true, playlists };
      } catch (error) {
        return { success: false, error: error.message };
      }

    case 'toggleMonitor':
      try {
        let playlist = await storage.getPlaylist(message.playlistId);
        if (playlist) {
          playlist.monitored = message.monitored;
          await storage.savePlaylist(playlist);
        } else if (message.monitored && message.playlistData) {
          // Add new playlist to storage
          playlist = {
            ...message.playlistData,
            monitored: true,
            snapshots: []
          };
          await storage.savePlaylist(playlist);
        }
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }

    case 'getSettings':
      try {
        const settings = await storage.getSettings();
        return { success: true, settings };
      } catch (error) {
        return { success: false, error: error.message };
      }

    case 'saveSettings':
      try {
        await storage.saveSettings(message.settings);
        await setupSyncAlarm();
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }

    case 'exportData':
      try {
        const data = await storage.exportData();
        return { success: true, data };
      } catch (error) {
        return { success: false, error: error.message };
      }

    case 'updateBadge':
      await updateBadge();
      return { success: true };

    default:
      return { success: false, error: 'Unknown action' };
  }
}
