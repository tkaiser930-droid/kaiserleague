KAISER FAMILY FANTASY SMX — NODE.JS + RENDER DEPLOYMENT

THIS PACKAGE IS READY TO DEPLOY, BUT IT IS NOT ALREADY LIVE. You must connect the project to a Git repository and create the Render service in your account.

RENDER DEPLOYMENT (RECOMMENDED)

IF RENDER SAYS “FAILED TO READ DOCKER FILE: NO SUCH FILE OR DIRECTORY”
This means the Render service is configured for the Docker runtime but cannot find a Dockerfile. This project now includes a Dockerfile at the project root. Upload the project contents (including Dockerfile, package.json, and server.js) to the root of the connected Git repository, or set the Render Root Directory / Dockerfile Path to the directory that contains them. Then redeploy.

For the simplest setup, use Render's native Node runtime instead of Docker: create a Web Service with Language = Node, Build Command = npm install, Start Command = npm start, and Health Check Path = /healthz. The included render.yaml configures this native Node approach. Do not configure a Docker runtime if you intend to use the native Node runtime.
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

MANUAL RENDER WEB SERVICE SETTINGS — NATIVE NODE (if not using Blueprint)
- Root Directory: repository root, where `package.json` and `server.js` live. Upload the contents of this project folder to the repository root, not a nested folder.
- Build Command: `npm install`
- Start Command: `npm start`
- Environment variable: `DATA_DIR=/var/data`
- Add a persistent disk mounted at `/var/data` (Starter/paid web service required).
- Health Check Path: `/healthz`
- `PORT` is assigned by Render; do not hardcode it in the dashboard. The server binds to `0.0.0.0` by default.

MANUAL RENDER WEB SERVICE SETTINGS — DOCKER RUNTIME
- Root Directory: folder containing Dockerfile, package.json, and server.js.
- Dockerfile Path: ./Dockerfile (unless the file is in a subdirectory).
- Do not enter a separate Build Command; Render builds the Dockerfile.
- The Dockerfile runs `npm start` and sets DATA_DIR=/var/data. Add a persistent disk mounted at /var/data.
- Health Check Path: /healthz.

RENDER STORAGE NOTES
Render's default filesystem is ephemeral. This package explicitly writes the database under `/var/data` and defines a persistent disk there through `render.yaml`. Do not remove the disk or change `DATA_DIR` to a location outside its mount path. A disk is attached to one service instance and doesn't support scaling that service to multiple instances.

SECURITY NOTICE — REVIEW BEFORE PUBLIC USE
The existing site's password and role checks were originally designed for a local prototype and mostly run in browser JavaScript. The JSON state API also currently accepts writes without server-side role validation. As supplied, this is not safe for a publicly accessible production league where untrusted visitors must not alter league data. Deploy only for private testing/trusted users until server-side authentication and permission checks are implemented. A frontend password is not sufficient protection. Do not put secrets in the repository.

BACKUPS
Use Data & Backup to download JSON backups regularly and before deploying updates. The persistent disk protects against ordinary redeploy/restart data loss, but is not a substitute for backups.

LATEST WEBSITE CHANGES — SCHEDULE + LIVE TEAM DRAFTS

SCHEDULE PAGE
- Schedule event dates are displayed as a written month, day, and year (example: May 30, 2027). Multi-day events display both dates in that format.
- Series badges have distinct color boxes: SMX purple, F1 gold, MXGP red, and MotoGP black.

LIVE TEAM DRAFT FLOW
1. Claim all five fantasy teams and create a team password for each team before starting a draft.
2. Sign in to Commissioner > Draft Management. Select a room (SMX, MXGP, MotoGP, or F1) and click Start Draft. Each room has its own independent status and pick history.
3. Draft order follows the team order displayed on the Teams page / team records. The order repeats each round. The draft page displays the next team, pick number, and round.
4. Each team opens Draft, selects the correct room, chooses its team, and signs in with that team's password. Only the team currently on the clock can submit a pick. After each pick, the turn moves to the next team.
5. The player list is limited to the selected room: SMX offers 250 and 450 riders; MXGP offers MXGP and MX2 riders; MotoGP and F1 offer their respective riders. Existing roster caps are enforced at selection time. Teams can pass a pick if needed.
6. The draft page refreshes the saved league state from the server every few seconds while open, so connected team browsers receive pick and turn updates without a manual page refresh.
7. The commissioner can pause or complete each room from Draft Management. Clicking Start Draft again resumes the existing pick history; it does not erase previous picks.

Draft room data is stored in the existing `kaiserFantasyDraftState` and `kaiserFantasyDraftSettings` categories in the project database. The app does not automatically randomize the order: the commissioner sets and saves a separate order for each draft room. Drafts use a snake sequence, reversing the order every other round. The site should only be used for private/trusted league testing until server-side authentication and authorization are implemented, as described in the Security Notice above.
