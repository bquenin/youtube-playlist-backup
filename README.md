# YouTube Playlist Backup

Chrome extension that monitors your YouTube playlists and tracks when videos become unavailable (deleted, private, or removed by YouTube).

## Features

- **Automatic sync** - Daily or weekly background sync of your playlists
- **Track unavailable videos** - See which videos in your playlists are no longer available
- **Preserve metadata** - Keeps the original title, channel, and thumbnail when a video becomes unavailable
- **Badge indicator** - Shows a badge when new videos become unavailable
- **Filmot integration** - Links to Filmot for looking up deleted video info

## Installation

### From source

1. Clone this repository
2. Open Chrome and go to `chrome://extensions`
3. Enable "Developer mode" (top right)
4. Click "Load unpacked" and select the repository folder

### From Chrome Web Store

Coming soon.

## Usage

1. Click the extension icon
2. Sign in with your Google account
3. Click "Refresh" to load your playlists
4. Your playlists are now being monitored

When videos become unavailable, you'll see:
- A badge on the extension icon
- The video listed in the "Unavailable" tab
- The video marked in the playlist detail view

## Permissions

- **identity** - Google OAuth sign-in
- **storage** - Store playlist data locally
- **alarms** - Schedule background syncs

## Privacy

- All data is stored locally in your browser
- No external servers or analytics
- Only communicates with YouTube Data API and Google OAuth

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Watch mode
npm run test:watch
```

## License

MIT
