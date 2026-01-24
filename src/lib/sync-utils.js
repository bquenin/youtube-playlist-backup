/**
 * Sync utilities for playlist operations
 */

/**
 * Check if a video is unavailable
 * @param {Object} video - Video object
 * @returns {boolean}
 */
export function isVideoUnavailable(video) {
  return video.isUnavailable || video.title === 'Deleted video' || video.title === 'Private video';
}

/**
 * Merge new videos with existing videos, preserving metadata for unavailable ones
 * @param {Object[]} existingVideos - Previously stored videos
 * @param {Object[]} newVideos - Fresh videos from API
 * @returns {Object[]} Merged videos with preserved metadata
 */
export function mergeVideos(existingVideos, newVideos) {
  const existingVideosMap = {};
  for (const v of existingVideos) {
    existingVideosMap[v.videoId] = v;
  }

  return newVideos.map(v => {
    const isUnavailable = isVideoUnavailable(v);
    const existing = existingVideosMap[v.videoId];

    // If video became unavailable but we have old metadata, preserve it
    if (isUnavailable && existing && !isVideoUnavailable(existing)) {
      return {
        ...v,
        originalTitle: existing.title,
        originalChannelTitle: existing.channelTitle,
        originalThumbnailUrl: existing.thumbnailUrl
      };
    }

    // If video was already unavailable with preserved metadata, keep it
    if (isUnavailable && existing?.originalTitle) {
      return {
        ...v,
        originalTitle: existing.originalTitle,
        originalChannelTitle: existing.originalChannelTitle,
        originalThumbnailUrl: existing.originalThumbnailUrl
      };
    }

    return v;
  });
}

/**
 * Count unavailable videos in a list
 * @param {Object[]} videos - Video list
 * @returns {number}
 */
export function countUnavailable(videos) {
  return videos.filter(isVideoUnavailable).length;
}
