# COE Budget Transparency and Financial Monitoring System

A centralized web application designed for the College of Engineering (COE) and LGU officers to monitor, manage, and publicly display financial activities in real time.

## Project Structure

- **`/client`**: Frontend application built with Vanilla JS and CSS.
- **`/server`**: Node.js/Express API for business logic and report generation.
- **`/supabase`**: Database migrations, RLS policies, and SQL setup.
- **`/docs`**: System documentation, requirements, and architecture diagrams.
- **`/scripts`**: Helper scripts for development and deployment.
- **`/electron`**: Native desktop application for admins (Electron-based).

## Technical Stack

- **Frontend**: HTML5, CSS3, JavaScript
- **Backend**: Node.js, Express
- **Database**: Supabase (PostgreSQL)
- **Auth/Storage**: Supabase Auth & Storage
- **Hosting**: Vercel (Frontend), Render (Backend)

## Getting Started (Local Development)

Prerequisites: Node.js (LTS recommended) and a Supabase project.

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create your environment file and fill in the values:
   ```bash
   cp .env.example .env
   ```
   | Variable | Purpose |
   | --- | --- |
   | `SUPABASE_URL` | Supabase project URL |
   | `SUPABASE_SERVICE_KEY` | Service-role key — **server-side only, never expose to the browser** |
   | `SUPABASE_ANON_KEY` | Public anon key used by the client |
   | `PORT` | Server port (defaults to `3000`) |
   | `NODE_ENV` | `development` or `production` |
   | `BREVO_API_KEY`, `BREVO_SENDER_EMAIL` | Outbound notification email (optional locally) |
   | `APP_URL`, `RENDER_EXTERNAL_URL` | Public base URL used when generating links in emails |
3. Start the server:
   ```bash
   npm start        # or: npm run dev (auto-reload via nodemon)
   ```
   The Express server serves the API and the `/client` frontend from a single origin — open [http://localhost:3000](http://localhost:3000).

## Core Features

1. **Real-Time Dashboard**: Live updates of total funds, expenses, and balances.
2. **Event Transparency**: Dedicated financial pages for individual engineering events.
3. **Receipt Management**: Digital storage and verification of all transaction proofs.
4. **Monitoring Systems**: Dedicated modules for donations and collections.

## Mobile App (PWA — no app store needed)

The system is a Progressive Web App: on a phone it installs to the home screen with its own icon and opens full-screen (no browser UI), just like a native app.

**Android (Chrome):** open the site once → tap **Install app** on the banner Chrome shows (or ⋮ menu → *Add to Home screen*). It installs as **"COE Student Portal"** with the COE logo as its icon.

**iPhone (Safari):** open the site → tap the **Share** button → **Add to Home Screen**.

**Notes**:
- `client/manifest.json` — app name, icon, and standalone display mode.
- `client/sw.js` — app-shell service worker: always fetches the latest files from the network, and keeps a cached copy only so the app still opens when the phone is offline (data still needs internet; `/api` and Supabase traffic are never cached for security).
- Icons are generated from `client/assets/coe-logo.png` by `node scripts/generate-pwa-icons.js`.
- Requires HTTPS in production (already true on Vercel). Skipped automatically inside the Electron desktop app.

## Desktop Application

A native desktop application is available for administrators built with Electron. See `docs/desktop-app.md` for details.

**Features**:
- System tray integration
- Native menus (File, Edit, View, Window, Help)
- Window management (hide to tray)
- Cross-platform (Windows, macOS, Linux)

**Development**:
```bash
cd electron
npm install
npm run dev
```

**Build**:
```bash
npm run package
```

## Active Development

- **Enrollment Verification & Real-Time Sync**: Phase B/C enrollment status verification, flat matte UI, and Supabase real-time updates (documented on `redesign` branch).

