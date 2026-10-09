# LGU System Admin Desktop App

## Overview

The LGU System Admin Desktop App is a native Electron-based application that wraps the existing web admin panel, providing desktop-specific enhancements including system tray integration, native menus, and improved offline capabilities.

## Features

### Desktop-Specific Features
- **System Tray Integration**: Minimize to tray with quick access
- **Native Menus**: File, Edit, View, Window, Help menus with platform-specific conventions
- **Window Management**: Hide on close instead of quitting, restore from tray
- **Context Isolation**: Secure IPC between main and renderer processes
- **Cross-Platform**: Windows, macOS, Linux support

### Web App Integration
- Same functionality as web admin panel
- Maintains all existing authentication and authorization
- Real-time updates via Supabase subscriptions
- Full admin panel access (Create Records, Budget Transfer, User Management, Audit Log)

## Installation

### For Users

1. Download the latest release from the releases page
2. Run the installer for your platform:
   - **Windows**: Install the `.exe` installer
   - **macOS**: Open the `.dmg` and drag to Applications
   - **Linux**: Install the `.AppImage` (make executable first)

### For Developers

1. Clone the repository
2. Install dependencies:
   ```bash
   cd electron
   npm install
   ```
3. Start development mode:
   ```bash
   npm run dev
   ```

## Building from Source

```bash
# Build the frontend first (repo root). The shell loads client/dist, which is
# also what electron-builder copies into the package as extraResources.
npm run client:install
npm run client:build

# Install dependencies
cd electron
npm install

# Package for distribution
npm run package

# Output will be in electron/dist-build/
```

## Configuration

### Environment Variables

The desktop app uses the same configuration as the web app. Ensure the following are set (for development):

- `SUPABASE_URL`: Your Supabase project URL
- `SUPABASE_ANON_KEY`: Supabase anonymous key
- `API_BASE`: Backend API URL (defaults to production)

### Electron-Specific Settings

Configuration is in `electron/package.json` under the `build` section:
- `appId`: Unique identifier
- `productName`: Display name
- `directories`: Output location
- `files`: What to include in the build
- `mac`/`win`/`linux`: Platform-specific build targets

## Usage

### First Run

1. Launch the application
2. You'll be presented with the same login screen as the web app
3. Use your existing credentials (G Suite account with `@g.cjc.edu.ph` domain)
4. Email confirmation required before access

### Admin Access

Only users with `admin` role can access admin features:
- Create new events and transactions
- Manage user roles
- Perform budget transfers
- View audit logs
- Generate PDF/Excel reports

### System Tray

- **Right-click**: Show context menu (Show App, Quit)
- **Left-click**: Toggle window visibility
- Window hides to tray when closed (can be disabled in code)

## Development

### Project Structure

```
electron/
├── main.js          # Main process
├── preload.js       # Preload script for secure IPC
├── menu.js          # Native menu definitions
├── package.json     # Electron dependencies and build config
└── resources/       # Icons and assets
```

### Key Files

- **main.js**: Creates BrowserWindow, system tray, native menus
- **preload.js**: Exposes safe APIs to renderer via contextBridge
- **menu.js**: Defines application menu structure
- **package.json**: Build configuration for electron-builder

### Security

- Context isolation enabled
- Node integration disabled in renderer
- Preload script only exposes whitelisted channels
- Same CORS and authentication as web app
- No direct file system access without user confirmation

## Troubleshooting

### Common Issues

**App won't start**
- Ensure Node.js version >= 18.0.0
- Run `npm install` in electron directory
- Check that the built client exists at `../client/dist/` (run `npm run client:build` at the repo root)

**Can't login**
- Same as web app: check internet connection
- Verify email confirmation
- Check Supabase credentials

**System tray not working**
- Requires OS support (some Linux distros need additional packages)
- Windows: Ensure proper icon files

**Build fails**
- Check electron-builder documentation
- Ensure sufficient disk space
- May need CodeSign for macOS (Apple Developer account)

## Release Checklist

Before releasing a new version:

1. Update version in `electron/package.json`
2. Test on all target platforms
3. Run validation tests: `node tests/electron/validation.js`
4. Build packages: `npm run package`
5. Test installers on clean systems
6. Update this documentation if needed
7. Create GitHub release with installers

## License

Same as main LGU System project.

## Support

For issues, please check the main project README and the electron directory README.md.
