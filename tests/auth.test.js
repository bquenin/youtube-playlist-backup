/**
 * Tests for OAuth token management and refresh logic
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetMockStorage, setMockStorage, getMockStorage } from './setup.js';

// Mock fetch globally
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

// Import after mocks are set up
const { getAuthToken, isAuthenticated } = await import('../src/lib/youtube-api.js');

describe('Token storage and retrieval', () => {
  beforeEach(() => {
    resetMockStorage();
    mockFetch.mockReset();
  });

  it('should return stored access token if not expired', async () => {
    const futureExpiry = Date.now() + 3600000; // 1 hour from now
    setMockStorage({
      accessToken: 'valid-access-token',
      refreshToken: 'valid-refresh-token',
      tokenExpiry: futureExpiry
    });

    const token = await getAuthToken(false);
    expect(token).toBe('valid-access-token');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should refresh token if access token is expired', async () => {
    const pastExpiry = Date.now() - 1000; // Already expired
    setMockStorage({
      accessToken: 'expired-access-token',
      refreshToken: 'valid-refresh-token',
      tokenExpiry: pastExpiry
    });

    // Mock successful refresh response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'new-access-token',
        expires_in: 3600
      })
    });

    const token = await getAuthToken(false);

    expect(token).toBe('new-access-token');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Verify refresh request was made correctly
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('https://oauth2.googleapis.com/token');
    expect(options.method).toBe('POST');
    expect(options.body.toString()).toContain('grant_type=refresh_token');
    expect(options.body.toString()).toContain('refresh_token=valid-refresh-token');
  });

  it('should store new access token after refresh', async () => {
    const pastExpiry = Date.now() - 1000;
    setMockStorage({
      accessToken: 'expired-access-token',
      refreshToken: 'valid-refresh-token',
      tokenExpiry: pastExpiry
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'new-access-token',
        expires_in: 3600
      })
    });

    await getAuthToken(false);

    const storage = getMockStorage();
    expect(storage.accessToken).toBe('new-access-token');
    expect(storage.refreshToken).toBe('valid-refresh-token'); // Should be preserved
    expect(storage.tokenExpiry).toBeGreaterThan(Date.now());
  });

  it('should throw error if refresh fails and not interactive', async () => {
    const pastExpiry = Date.now() - 1000;
    setMockStorage({
      accessToken: 'expired-access-token',
      refreshToken: 'invalid-refresh-token',
      tokenExpiry: pastExpiry
    });

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: 'invalid_grant' })
    });

    await expect(getAuthToken(false)).rejects.toThrow();
  });

  it('should throw error if no tokens and not interactive', async () => {
    resetMockStorage(); // No tokens stored

    await expect(getAuthToken(false)).rejects.toThrow('No valid token');
  });

  it('should throw error if only access token expired and no refresh token', async () => {
    const pastExpiry = Date.now() - 1000;
    setMockStorage({
      accessToken: 'expired-access-token',
      tokenExpiry: pastExpiry
      // No refresh token
    });

    await expect(getAuthToken(false)).rejects.toThrow('No valid token');
  });
});

describe('Authentication status', () => {
  beforeEach(() => {
    resetMockStorage();
  });

  it('should return true if refresh token exists', async () => {
    setMockStorage({
      refreshToken: 'valid-refresh-token'
    });

    const authenticated = await isAuthenticated();
    expect(authenticated).toBe(true);
  });

  it('should return false if no refresh token', async () => {
    setMockStorage({
      accessToken: 'some-access-token'
      // No refresh token
    });

    const authenticated = await isAuthenticated();
    expect(authenticated).toBe(false);
  });

  it('should return false if storage is empty', async () => {
    resetMockStorage();

    const authenticated = await isAuthenticated();
    expect(authenticated).toBe(false);
  });
});

describe('Token expiry buffer', () => {
  beforeEach(() => {
    resetMockStorage();
    mockFetch.mockReset();
  });

  it('should apply 1 minute buffer when storing tokens', async () => {
    // Token expires in 30 seconds - still valid (buffer applied at storage time)
    const nearExpiry = Date.now() + 30000;
    setMockStorage({
      accessToken: 'almost-expired-token',
      refreshToken: 'valid-refresh-token',
      tokenExpiry: nearExpiry
    });

    const token = await getAuthToken(false);

    // Token is still valid (expiry is in the future)
    expect(token).toBe('almost-expired-token');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should store token with 1 minute buffer subtracted', async () => {
    const pastExpiry = Date.now() - 1000;
    setMockStorage({
      accessToken: 'expired-token',
      refreshToken: 'valid-refresh-token',
      tokenExpiry: pastExpiry
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'new-access-token',
        expires_in: 3600 // 1 hour
      })
    });

    await getAuthToken(false);

    const storage = getMockStorage();
    // Expiry should be ~59 minutes from now (3600s - 60s buffer)
    const expectedExpiry = Date.now() + (3600 * 1000) - 60000;
    expect(storage.tokenExpiry).toBeGreaterThan(expectedExpiry - 1000);
    expect(storage.tokenExpiry).toBeLessThan(expectedExpiry + 1000);
  });
});

describe('Background sync simulation', () => {
  beforeEach(() => {
    resetMockStorage();
    mockFetch.mockReset();
  });

  it('should handle multiple sequential refreshes', async () => {
    // Simulate time passing and multiple background syncs
    const pastExpiry = Date.now() - 1000;
    setMockStorage({
      accessToken: 'expired-token',
      refreshToken: 'valid-refresh-token',
      tokenExpiry: pastExpiry
    });

    // First refresh
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'new-token-1',
        expires_in: 3600
      })
    });

    const token1 = await getAuthToken(false);
    expect(token1).toBe('new-token-1');

    // Simulate token expiring again
    const storage = getMockStorage();
    storage.tokenExpiry = Date.now() - 1000;
    setMockStorage(storage);

    // Second refresh
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'new-token-2',
        expires_in: 3600
      })
    });

    const token2 = await getAuthToken(false);
    expect(token2).toBe('new-token-2');

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
