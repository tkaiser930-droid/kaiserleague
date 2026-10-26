KAISER FAMILY FANTASY SMX — NODE.JS + RENDER DEPLOYMENT

THIS PACKAGE IS READY TO DEPLOY, BUT IT IS NOT ALREADY LIVE. You must connect the project to a Git repository and create the Render service in your account.

RENDER DEPLOYMENT (RECOMMENDED)
1. Download and extract this ZIP.
2. Create a new private GitHub repository for the project. Upload the CONTENTS of the `kaiser-family-fantasy-smx` folder to the repository root (so `render.yaml`, `package.json`, and `server.js` are at the top level). Do not upload your local `data/league-data.json`; `.gitignore` excludes it.
3. In Render, choose New > Blueprint and connect that GitHub repository. Render reads `render.yaml` to configure the Node web service.
4. Review the service before applying it. The Blueprint config selects a Starter web service with a 1 GB persistent disk mounted at `/var/data`; persistent disks require a paid Render service. Review current pricing in Render before deploying.
5. Deploy. Render supplies `PORT`; `server.js` binds to `0.0.0.0` by default (including deployments created manually without the `HOST` variable) and uses `/var/data/league-data.json` for the persistent database when `DATA_DIR=/var/data` is configured. Health check: `/healthz`.
6. Open the generated `https://<your-service>.onrender.com` URL. The storage banner should say it is saving to the Render persistent disk.

IMPORTANT: SAVED DATA FROM YOUR LOCAL SITE
The Render service starts with its own database. It cannot directly read the database file on your computer. Before moving an existing league, open your previous local website at the same address you used before and go to Data & Backup > Download League Backup. After the Render site is live, use Data & Backup > Restore a backup to import that JSON file. Confirm your riders, rosters, scores, trades, draft, and schedule are present before continuing league operations. Download periodic backups after deployment too.

LOCAL DEVELOPMENT
1. Install Node.js 22 or newer.
2. Open this folder in VS Code and open Terminal > New Terminal.
3. Run `npm start`.
4. Open `http://127.0.0.1:5500/`. The local database is stored in `data/league-data.json`.
5. Stop Live Server first if it is using port 5500.

MANUAL RENDER WEB SERVICE SETTINGS (if not using Blueprint)
- Root Directory: repository root, where `package.json` and `server.js` live. Upload the contents of this project folder to the repository root, not a nested folder.
- Build Command: `npm install`
- Start Command: `npm start`
- Environment variable: `DATA_DIR=/var/data`
- Add a persistent disk mounted at `/var/data` (Starter/paid web service required).
- Health Check Path: `/healthz`
- `PORT` is assigned by Render; do not hardcode it in the dashboard. The server binds to `0.0.0.0` by default.

RENDER STORAGE NOTES
Render's default filesystem is ephemeral. This package explicitly writes the database under `/var/data` and defines a persistent disk there through `render.yaml`. Do not remove the disk or change `DATA_DIR` to a location outside its mount path. A disk is attached to one service instance and doesn't support scaling that service to multiple instances.

SECURITY NOTICE — REVIEW BEFORE PUBLIC USE
The existing site's password and role checks were originally designed for a local prototype and mostly run in browser JavaScript. The JSON state API also currently accepts writes without server-side role validation. As supplied, this is not safe for a publicly accessible production league where untrusted visitors must not alter league data. Deploy only for private testing/trusted users until server-side authentication and permission checks are implemented. A frontend password is not sufficient protection. Do not put secrets in the repository.

BACKUPS
Use Data & Backup to download JSON backups regularly and before deploying updates. The persistent disk protects against ordinary redeploy/restart data loss, but is not a substitute for backups.
