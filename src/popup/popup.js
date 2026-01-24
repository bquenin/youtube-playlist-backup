/**
 * Popup UI Logic
 */

// State
let currentPlaylistId = null;
let userPlaylists = [];
let storedPlaylists = {};
let settings = {};

// DOM Elements
const views = {
  login: document.getElementById('loginView'),
  main: document.getElementById('mainView'),
  settings: document.getElementById('settingsView'),
  playlistDetail: document.getElementById('playlistDetailView')
};

const elements = {
  // Buttons
  signInBtn: document.getElementById('signInBtn'),
  signOutBtn: document.getElementById('signOutBtn'),
  settingsBtn: document.getElementById('settingsBtn'),
  backBtn: document.getElementById('backBtn'),
  backToMainBtn: document.getElementById('backToMainBtn'),
  refreshBtn: document.getElementById('refreshBtn'),
  syncPlaylistBtn: document.getElementById('syncPlaylistBtn'),

  // Lists
  playlistsList: document.getElementById('playlistsList'),
  removedList: document.getElementById('removedList'),
  playlistVideosList: document.getElementById('playlistVideosList'),

  // Detail filter
  detailFilter: document.getElementById('detailFilter'),

  // Inputs
  searchInput: document.getElementById('searchInput'),
  syncFrequency: document.getElementById('syncFrequency'),

  // Info displays
  detailTitle: document.getElementById('detailTitle'),
  detailStats: document.getElementById('detailStats'),
  statusBar: document.getElementById('statusBar'),
  statusMessage: document.getElementById('statusMessage')
};

// Initialize
document.addEventListener('DOMContentLoaded', init);

async function init() {
  setupEventListeners();
  await checkSetupAndAuth();
}

function setupEventListeners() {
  // Auth buttons
  elements.signInBtn.addEventListener('click', handleSignIn);
  elements.signOutBtn.addEventListener('click', handleSignOut);

  // Navigation
  elements.settingsBtn.addEventListener('click', () => showView('settings'));
  elements.backBtn.addEventListener('click', handleBackFromSettings);
  elements.backToMainBtn.addEventListener('click', () => showView('main'));

  // Actions
  elements.refreshBtn.addEventListener('click', handleRefresh);
  elements.syncPlaylistBtn.addEventListener('click', handleSyncPlaylist);

  // Search
  elements.searchInput.addEventListener('input', handleSearch);

  // Detail filter
  elements.detailFilter.addEventListener('change', handleDetailFilterChange);

  // Settings
  elements.syncFrequency.addEventListener('change', handleSettingChange);

  // Tab navigation
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', handleTabClick);
  });
}

// View Management
function showView(viewName) {
  Object.values(views).forEach(view => view.classList.add('hidden'));
  views[viewName].classList.remove('hidden');
}

function handleTabClick(event) {
  const tab = event.currentTarget;
  const tabName = tab.dataset.tab;
  const tabContainer = tab.closest('nav.tabs');
  const contentContainer = tabContainer.parentElement;

  // Update tab buttons
  tabContainer.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');

  // Update tab contents
  contentContainer.querySelectorAll('.tab-content').forEach(content => {
    content.classList.add('hidden');
    content.classList.remove('active');
  });

  const targetContent = document.getElementById(`${tabName}Tab`);
  if (targetContent) {
    targetContent.classList.remove('hidden');
    targetContent.classList.add('active');
  }
}

// Status Management
function showStatus(message, duration = 3000) {
  elements.statusMessage.textContent = message;
  elements.statusBar.classList.remove('hidden');

  if (duration > 0) {
    setTimeout(() => {
      elements.statusBar.classList.add('hidden');
    }, duration);
  }
}

// Communication with background
async function sendMessage(action, data = {}) {
  return chrome.runtime.sendMessage({ action, ...data });
}

// Auth Flow
async function checkSetupAndAuth() {
  // Check auth status
  const authResponse = await sendMessage('getAuthStatus');

  if (authResponse.authenticated) {
    showView('main');
    await loadData();
  } else {
    showView('login');
  }
}

async function handleSignIn() {
  elements.signInBtn.disabled = true;
  elements.signInBtn.textContent = 'Signing in...';

  const response = await sendMessage('signIn');

  if (response.success) {
    showView('main');
    await loadData();
  } else {
    showStatus('Sign in failed: ' + (response.error || 'Unknown error'));
  }

  elements.signInBtn.disabled = false;
  elements.signInBtn.textContent = 'Sign in with Google';
}

async function handleSignOut() {
  await sendMessage('signOut');
  showView('login');
  userPlaylists = [];
  storedPlaylists = {};
}

async function handleBackFromSettings() {
  // Check if we're authenticated to decide where to go back to
  const response = await sendMessage('getAuthStatus');
  if (response.authenticated) {
    showView('main');
  } else {
    showView('login');
  }
}

// Data Loading
async function loadData() {
  await Promise.all([
    loadSettings(),
    loadStoredPlaylists()
  ]);
  updateUI();
}

async function loadSettings() {
  const response = await sendMessage('getSettings');
  if (response.success) {
    settings = response.settings;
    applySettingsToUI();
  }
}

function applySettingsToUI() {
  elements.syncFrequency.value = settings.syncFrequency || 'daily';
}

async function loadStoredPlaylists() {
  const storedResponse = await sendMessage('getStoredPlaylists');
  if (storedResponse.success) {
    storedPlaylists = storedResponse.playlists;
    userPlaylists = Object.values(storedPlaylists);
  }
}

async function handleRefresh() {
  elements.refreshBtn.disabled = true;
  elements.playlistsList.innerHTML = '<div class="loading">Refreshing playlists...</div>';

  // Fetch user's playlists from YouTube
  const response = await sendMessage('fetchPlaylists');

  if (response.success) {
    userPlaylists = response.playlists;

    // Auto-save new playlists as monitored
    for (const playlist of userPlaylists) {
      if (!storedPlaylists[playlist.playlistId]) {
        await sendMessage('toggleMonitor', {
          playlistId: playlist.playlistId,
          monitored: true,
          playlistData: playlist
        });
        storedPlaylists[playlist.playlistId] = { ...playlist, monitored: true, videos: [] };
      }
    }

    // Sync all monitored playlists
    const syncResponse = await sendMessage('syncAll');

    // Reload data
    const storedResponse = await sendMessage('getStoredPlaylists');
    if (storedResponse.success) {
      storedPlaylists = storedResponse.playlists;
    }

    updateUI();

  } else {
    showStatus('Failed to load: ' + response.error);
    renderPlaylists(); // Show whatever we have stored
  }

  elements.refreshBtn.disabled = false;
}


// UI Rendering
function updateUI() {
  renderPlaylists();
  renderUnavailableVideos();
}

function renderPlaylists() {
  if (userPlaylists.length === 0) {
    elements.playlistsList.innerHTML = '<div class="empty-state">Click Refresh to load your playlists</div>';
    return;
  }

  elements.playlistsList.innerHTML = userPlaylists.map(playlist => {
    const stored = storedPlaylists[playlist.playlistId];

    // Count unavailable videos
    const videos = stored?.videos || [];
    const unavailableCount = videos.filter(v =>
      v.isUnavailable || v.title === 'Deleted video' || v.title === 'Private video'
    ).length;

    return `
      <div class="playlist-item" data-id="${playlist.playlistId}">
        <img class="playlist-thumbnail" src="${playlist.thumbnailUrl || 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 90"%3E%3Crect fill="%23eee" width="120" height="90"/%3E%3C/svg%3E'}" alt="">
        <div class="playlist-info">
          <div class="playlist-title">${escapeHtml(playlist.title)}</div>
          <div class="playlist-meta">
            ${playlist.itemCount} videos
            ${unavailableCount > 0 ? `<span class="unavailable-indicator">${unavailableCount} unavailable</span>` : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Add event listeners
  elements.playlistsList.querySelectorAll('.playlist-item').forEach(item => {
    item.addEventListener('click', () => openPlaylistDetail(item.dataset.id));
  });
}

function renderUnavailableVideos() {
  const allUnavailable = [];

  // Find videos that are in playlists but unavailable on YouTube
  for (const [playlistId, playlist] of Object.entries(storedPlaylists)) {
    const playlistTitle = playlist?.title || 'Unknown Playlist';
    const videos = playlist?.videos || [];

    for (const video of videos) {
      if (video.isUnavailable || video.title === 'Deleted video' || video.title === 'Private video') {
        allUnavailable.push({
          ...video,
          playlistId,
          playlistTitle
        });
      }
    }
  }

  if (allUnavailable.length === 0) {
    elements.removedList.innerHTML = '<div class="empty-state">No unavailable videos detected yet</div>';
    return;
  }

  elements.removedList.innerHTML = allUnavailable.map(video => renderVideoItem(video, { showPlaylist: true })).join('');
}

function renderVideoItem(video, options = {}) {
  const { showPlaylist = false, showAddedDate = false } = options;
  const isUnavailable = video.isUnavailable || video.title === 'Deleted video' || video.title === 'Private video';

  // Determine display title (use preserved original if available)
  let displayTitle = video.title;
  if (isUnavailable && video.originalTitle) {
    displayTitle = video.originalTitle;
  }

  // Determine display channel
  const displayChannel = video.originalChannelTitle || video.channelTitle || (isUnavailable ? 'Unknown channel' : 'Unknown');

  // Determine thumbnail
  const thumbnailUrl = video.thumbnailUrl || video.originalThumbnailUrl || 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 90"%3E%3Crect fill="%23ddd" width="120" height="90"/%3E%3C/svg%3E';

  // Link to Filmot for unavailable videos (manual search), YouTube for available ones
  const videoUrl = isUnavailable
    ? `https://filmot.com/video/${video.videoId}`
    : `https://www.youtube.com/watch?v=${video.videoId}`;
  const linkTitle = isUnavailable ? 'Search on Filmot' : 'Open on YouTube';

  const hasRecoveredData = video.originalTitle;

  return `
    <div class="video-item ${isUnavailable ? 'unavailable' : ''}">
      <img class="video-thumbnail" src="${thumbnailUrl}" alt="">
      <div class="video-info">
        <div class="video-title">
          ${escapeHtml(displayTitle)}
          ${isUnavailable ? '<span class="unavailable-badge">Unavailable</span>' : ''}
          ${isUnavailable && hasRecoveredData ? '<span class="recovered-badge">Recovered</span>' : ''}
        </div>
        <div class="video-channel">${escapeHtml(displayChannel)}</div>
        ${showPlaylist && video.playlistTitle ? `<div class="video-playlist">From: ${escapeHtml(video.playlistTitle)}</div>` : ''}
        ${showAddedDate && video.addedAt ? `<div class="video-meta">Added to playlist: ${formatDate(new Date(video.addedAt).getTime())}</div>` : ''}
        ${isUnavailable && !hasRecoveredData ? `<div class="video-id">ID: ${video.videoId}</div>` : ''}
      </div>
      <a class="video-link" href="${videoUrl}" target="_blank" title="${linkTitle}">
        <svg viewBox="0 0 24 24" width="20" height="20">
          <path fill="currentColor" d="M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/>
        </svg>
      </a>
    </div>
  `;
}


// Playlist Detail View
let currentDetailVideos = []; // Store for filtering

async function openPlaylistDetail(playlistId) {
  currentPlaylistId = playlistId;
  const playlist = storedPlaylists[playlistId] || userPlaylists.find(p => p.playlistId === playlistId);

  if (!playlist) {
    showStatus('Playlist not found');
    return;
  }

  elements.detailTitle.textContent = playlist.title;

  // Get current videos
  const storedPlaylist = storedPlaylists[playlistId];
  const currentVideos = storedPlaylist?.videos || [];

  currentDetailVideos = currentVideos;

  // Count unavailable videos
  const unavailableCount = currentVideos.filter(v =>
    v.isUnavailable || v.title === 'Deleted video' || v.title === 'Private video'
  ).length;

  elements.detailStats.textContent = `${currentVideos.length} videos${unavailableCount > 0 ? ` • ${unavailableCount} unavailable` : ''}`;

  // Load saved filter preference (default to 'removed' = unavailable only)
  const filterData = await chrome.storage.local.get('detailFilter');
  elements.detailFilter.value = filterData.detailFilter || 'removed';

  renderDetailVideos();
  showView('playlistDetail');
}

function renderDetailVideos() {
  const filter = elements.detailFilter.value;

  let videosToShow = currentDetailVideos;
  if (filter === 'removed') {
    videosToShow = currentDetailVideos.filter(v =>
      v.isUnavailable || v.title === 'Deleted video' || v.title === 'Private video'
    );
  }

  if (videosToShow.length === 0) {
    if (filter === 'removed') {
      elements.playlistVideosList.innerHTML = '<div class="empty-state">No unavailable videos</div>';
    } else {
      elements.playlistVideosList.innerHTML = '<div class="empty-state">Click sync to capture videos</div>';
    }
    return;
  }

  elements.playlistVideosList.innerHTML = videosToShow.map(video =>
    renderVideoItem(video, { showAddedDate: true })
  ).join('');
}

async function handleDetailFilterChange() {
  await chrome.storage.local.set({ detailFilter: elements.detailFilter.value });
  renderDetailVideos();
}

// Action Handlers
async function handleSyncPlaylist() {
  if (!currentPlaylistId) return;

  elements.syncPlaylistBtn.disabled = true;
  showStatus('Refreshing playlist...', 0);

  const response = await sendMessage('syncPlaylist', { playlistId: currentPlaylistId });

  if (response.success) {
    // Reload stored playlists
    const storedResponse = await sendMessage('getStoredPlaylists');
    if (storedResponse.success) {
      storedPlaylists = storedResponse.playlists;
    }

    // Refresh detail view with new data
    await openPlaylistDetail(currentPlaylistId);

    elements.statusBar.classList.add('hidden');
  } else {
    showStatus('Sync failed: ' + (response.error || 'Unknown error'));
  }

  elements.syncPlaylistBtn.disabled = false;
}

async function handleSettingChange() {
  const newSettings = {
    syncFrequency: elements.syncFrequency.value
  };

  const response = await sendMessage('saveSettings', { settings: newSettings });

  if (response.success) {
    settings = newSettings;
    showStatus('Settings saved');
  } else {
    showStatus('Failed to save settings');
  }
}

function handleSearch(event) {
  const query = event.target.value.toLowerCase().trim();

  if (!query) {
    renderUnavailableVideos();
    return;
  }

  const allUnavailable = [];

  for (const [playlistId, playlist] of Object.entries(storedPlaylists)) {
    const playlistTitle = playlist?.title || 'Unknown Playlist';
    const videos = playlist?.videos || [];

    for (const video of videos) {
      if (video.isUnavailable || video.title === 'Deleted video' || video.title === 'Private video') {
        if (video.title?.toLowerCase().includes(query) ||
            video.channelTitle?.toLowerCase().includes(query) ||
            video.videoId?.toLowerCase().includes(query)) {
          allUnavailable.push({ ...video, playlistId, playlistTitle });
        }
      }
    }
  }

  if (allUnavailable.length === 0) {
    elements.removedList.innerHTML = '<div class="empty-state">No matching videos found</div>';
  } else {
    elements.removedList.innerHTML = allUnavailable.map(video => renderVideoItem(video, { showPlaylist: true })).join('');
  }
}

// Utility Functions
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatDate(timestamp) {
  if (!timestamp) return 'Unknown';
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}
