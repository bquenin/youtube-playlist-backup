/**
 * Tests for playlist sync logic
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { resetMockStorage, setMockStorage } from './setup.js';
import { mergeVideos, isVideoUnavailable, countUnavailable } from '../src/lib/sync-utils.js';

describe('Video availability detection', () => {
  it('should detect "Deleted video" as unavailable', () => {
    const video = { videoId: 'abc123', title: 'Deleted video' };
    expect(isVideoUnavailable(video)).toBe(true);
  });

  it('should detect "Private video" as unavailable', () => {
    const video = { videoId: 'abc123', title: 'Private video' };
    expect(isVideoUnavailable(video)).toBe(true);
  });

  it('should detect isUnavailable flag', () => {
    const video = { videoId: 'abc123', title: 'Some title', isUnavailable: true };
    expect(isVideoUnavailable(video)).toBe(true);
  });

  it('should not flag available videos', () => {
    const video = { videoId: 'abc123', title: 'My Cool Video', channelTitle: 'My Channel' };
    expect(isVideoUnavailable(video)).toBe(false);
  });

  it('should count unavailable videos correctly', () => {
    const videos = [
      { videoId: 'vid1', title: 'Available Video' },
      { videoId: 'vid2', title: 'Deleted video' },
      { videoId: 'vid3', title: 'Private video' },
      { videoId: 'vid4', title: 'Another Available', isUnavailable: false },
      { videoId: 'vid5', title: 'Some Title', isUnavailable: true }
    ];
    expect(countUnavailable(videos)).toBe(3);
  });
});

describe('Video metadata preservation', () => {
  it('should preserve metadata when video becomes unavailable', () => {
    const existingVideos = [
      {
        videoId: 'abc123',
        title: 'Original Title',
        channelTitle: 'Original Channel',
        thumbnailUrl: 'https://example.com/thumb.jpg'
      }
    ];

    const newVideos = [
      {
        videoId: 'abc123',
        title: 'Deleted video',
        channelTitle: '',
        thumbnailUrl: ''
      }
    ];

    const merged = mergeVideos(existingVideos, newVideos);

    expect(merged[0].title).toBe('Deleted video');
    expect(merged[0].originalTitle).toBe('Original Title');
    expect(merged[0].originalChannelTitle).toBe('Original Channel');
    expect(merged[0].originalThumbnailUrl).toBe('https://example.com/thumb.jpg');
  });

  it('should keep preserved metadata across multiple syncs', () => {
    // First sync: video was available
    const existingVideos = [
      {
        videoId: 'abc123',
        title: 'Deleted video',
        originalTitle: 'Original Title',
        originalChannelTitle: 'Original Channel',
        originalThumbnailUrl: 'https://example.com/thumb.jpg'
      }
    ];

    // Second sync: video still unavailable
    const newVideos = [
      {
        videoId: 'abc123',
        title: 'Deleted video',
        channelTitle: '',
        thumbnailUrl: ''
      }
    ];

    const merged = mergeVideos(existingVideos, newVideos);

    expect(merged[0].originalTitle).toBe('Original Title');
    expect(merged[0].originalChannelTitle).toBe('Original Channel');
    expect(merged[0].originalThumbnailUrl).toBe('https://example.com/thumb.jpg');
  });

  it('should not add original fields for videos that were never available', () => {
    const existingVideos = [];

    const newVideos = [
      {
        videoId: 'abc123',
        title: 'Deleted video',
        channelTitle: '',
        thumbnailUrl: ''
      }
    ];

    const merged = mergeVideos(existingVideos, newVideos);

    expect(merged[0].originalTitle).toBeUndefined();
    expect(merged[0].originalChannelTitle).toBeUndefined();
  });

  it('should handle video becoming available again', () => {
    const existingVideos = [
      {
        videoId: 'abc123',
        title: 'Private video',
        originalTitle: 'Original Title'
      }
    ];

    // Video is now public again
    const newVideos = [
      {
        videoId: 'abc123',
        title: 'My Video Is Back',
        channelTitle: 'My Channel',
        thumbnailUrl: 'https://example.com/new-thumb.jpg'
      }
    ];

    const merged = mergeVideos(existingVideos, newVideos);

    expect(merged[0].title).toBe('My Video Is Back');
    expect(merged[0].originalTitle).toBeUndefined();
  });

  it('should handle mixed available and unavailable videos', () => {
    const existingVideos = [
      { videoId: 'vid1', title: 'Video One', channelTitle: 'Channel A' },
      { videoId: 'vid2', title: 'Video Two', channelTitle: 'Channel B' },
      { videoId: 'vid3', title: 'Video Three', channelTitle: 'Channel C' }
    ];

    const newVideos = [
      { videoId: 'vid1', title: 'Video One', channelTitle: 'Channel A' }, // Still available
      { videoId: 'vid2', title: 'Deleted video', channelTitle: '' }, // Became unavailable
      { videoId: 'vid3', title: 'Video Three', channelTitle: 'Channel C' } // Still available
    ];

    const merged = mergeVideos(existingVideos, newVideos);

    expect(merged[0].title).toBe('Video One');
    expect(merged[0].originalTitle).toBeUndefined();

    expect(merged[1].title).toBe('Deleted video');
    expect(merged[1].originalTitle).toBe('Video Two');
    expect(merged[1].originalChannelTitle).toBe('Channel B');

    expect(merged[2].title).toBe('Video Three');
    expect(merged[2].originalTitle).toBeUndefined();
  });

  it('should handle new videos added to playlist', () => {
    const existingVideos = [
      { videoId: 'vid1', title: 'Video One', channelTitle: 'Channel A' }
    ];

    const newVideos = [
      { videoId: 'vid1', title: 'Video One', channelTitle: 'Channel A' },
      { videoId: 'vid2', title: 'New Video', channelTitle: 'Channel B' } // Newly added
    ];

    const merged = mergeVideos(existingVideos, newVideos);

    expect(merged).toHaveLength(2);
    expect(merged[1].title).toBe('New Video');
  });

  it('should handle videos removed from playlist', () => {
    const existingVideos = [
      { videoId: 'vid1', title: 'Video One', channelTitle: 'Channel A' },
      { videoId: 'vid2', title: 'Video Two', channelTitle: 'Channel B' }
    ];

    // vid2 was removed from playlist
    const newVideos = [
      { videoId: 'vid1', title: 'Video One', channelTitle: 'Channel A' }
    ];

    const merged = mergeVideos(existingVideos, newVideos);

    expect(merged).toHaveLength(1);
    expect(merged[0].videoId).toBe('vid1');
  });
});

describe('Storage operations', () => {
  beforeEach(() => {
    resetMockStorage();
  });

  it('should store and retrieve playlists', async () => {
    const playlist = {
      playlistId: 'PL123',
      title: 'Test Playlist',
      videos: [
        { videoId: 'vid1', title: 'Video One' }
      ]
    };

    await chrome.storage.local.set({ playlists: { 'PL123': playlist } });
    const data = await chrome.storage.local.get('playlists');

    expect(data.playlists['PL123'].title).toBe('Test Playlist');
    expect(data.playlists['PL123'].videos).toHaveLength(1);
  });

  it('should update playlist videos', async () => {
    // Initial state
    setMockStorage({
      playlists: {
        'PL123': {
          playlistId: 'PL123',
          title: 'Test Playlist',
          videos: [
            { videoId: 'vid1', title: 'Video One' }
          ]
        }
      }
    });

    // Update
    const data = await chrome.storage.local.get('playlists');
    data.playlists['PL123'].videos.push({ videoId: 'vid2', title: 'Video Two' });
    await chrome.storage.local.set({ playlists: data.playlists });

    // Verify
    const updated = await chrome.storage.local.get('playlists');
    expect(updated.playlists['PL123'].videos).toHaveLength(2);
  });
});
