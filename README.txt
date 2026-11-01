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
2. Sign in to Commissioner > Draft Management. Select a room (SMX, Triple Crown Series, MXGP, MotoGP, or F1) and click Start Draft. Each room has its own independent status and pick history.
3. Draft order follows the team order displayed on the Teams page / team records. The order repeats each round. The draft page displays the next team, pick number, and round.
4. Each team opens Draft, selects the correct room, chooses its team, and signs in with that team's password. Only the team currently on the clock can submit a pick. After each pick, the turn moves to the next team.
5. The player list is limited to the selected draft room: SMX includes 250, 450, SMX Next, and USA WMX; MXGP includes MXGP, MX2, and WMX; Triple Crown Series includes CAN 250, CAN 450, and CAN WMX; MotoGP and F1 offer their respective riders. Existing primary-series roster caps are enforced at selection time. Teams can pass a pick if needed.
6. The draft page refreshes the saved league state from the server every few seconds while open, so connected team browsers receive pick and turn updates without a manual page refresh.
7. The commissioner can pause or complete each room from Draft Management. Clicking Start Draft again resumes the existing pick history; it does not erase previous picks.

Draft room data is stored in the existing `kaiserFantasyDraftState` and `kaiserFantasyDraftSettings` categories in the project database. The app does not automatically randomize the order: the commissioner sets and saves a separate order for each draft room. Drafts use a snake sequence, reversing the order every other round. The site should only be used for private/trusted league testing until server-side authentication and authorization are implemented, as described in the Security Notice above.


LATEST HOME PAGE CHANGES — STANDINGS + UNDRAFTED LEADERS

HOME PAGE TEAM STANDINGS
- The standings table includes separate F1, MotoGP, SMX, and MXGP point columns, plus the overall team total.
- SMX standings include results scored in 250, 450, SMX Next, USA WMX, CAN 250, and CAN 450 divisions. MXGP standings include results scored in MXGP, MX2, WMX, and CAN WMX divisions. Triple Crown Series remains a separate schedule, draft, and scoring category; its division results are also attributed to the corresponding SMX or MXGP team standings column. MXON scores are attributed to the relevant rider primary-series bucket.
- Series totals use the team attribution recorded when race results were submitted, so past points do not move when a rider later changes teams.

TOP SCORING UNDRAFTED ATHLETES
- A leaderboard appears directly under Team Standings with one current free agent from each primary roster class, including 250, 450, SMX Next, USA WMX, MXGP, MX2, WMX, CAN 250, CAN 450, CAN WMX, F1, and MotoGP.
- The leader is the currently unrostered athlete with the most accumulated recorded race points in that division.
- If no unrostered athlete in a division has recorded results yet, the table shows an empty-state message for that division.

LATEST COMMISSIONER FEATURES — EVENT EDITING + COUNTRY / SUB-REGIONS

SCHEDULE EVENTS
- The Commissioner Dashboard's schedule event table now has an Edit Event button beside each event, plus Delete.
- Editing loads the event into the schedule form and saves changes to the existing event record; it does not create a duplicate.
- New events require a country. The state / province / region selector appears with options for the United States, Canada, Australia, United Kingdom, New Zealand, Germany, Brazil, Mexico, Japan, India, South Africa, Spain, Italy, and Argentina. For other countries, the country flag and country name can still be saved without a sub-region.
- Schedule and Commissioner tables display the country flag first, followed by the country name and selected state / province / region.
- Older saved events without country data display "Not set" until edited. Open Edit Event to add their country and optional sub-region.

RIDER NATIONALITY / SUB-REGIONS
- Add Athlete and Edit Rider now have a country/nationality dropdown and a state / province / region dropdown.
- The country flag is shown first, followed by the country and selected sub-region beside the rider name throughout athlete, roster, Commissioner, scoring history, draft, and trade tables.
- Existing rider nationalities are retained. Existing riders can be edited to add a sub-region. Region data is stored with the rider and carried into future score and draft records.


MANUFACTURER LOGO UPDATE — GASGAS
- Added the GASGAS red emblem and wordmark image to manufacturer badges and rider sidebars.
- Recognizes both “GasGas” and “Gas Gas” spellings in manufacturer/team labels.
- The logo is served from Wikimedia Commons, which identifies the SVG as originating from the GASGAS media asset bank. An internet connection is required for this image.


LATEST SERIES / RIDER AFFILIATION / ROSTER UPDATE

PRIMARY SERIES
- Rider creation and Edit Rider support one required Primary Series and multiple optional Secondary Series affiliations. Secondary affiliations are not limited to two; the rider can be linked to any number of the available additional series.
- Roster quotas, roster validation, draft quota checks, trades, roster display counts, and team management count each athlete only against the athlete's Primary Series. Secondary Series are displayed as additional affiliations and do not consume extra roster spots.
- Triple Crown Series is a standalone schedule/scoring category and draft room. Its divisions are CAN 250, CAN 450, and CAN WMX.

SERIES GROUPS AND ROSTER REQUIREMENTS
- SMX draft room: 250 (3), 450 (3), SMX Next (1), USA WMX (1).
- MXGP draft room: MXGP (3), MX2 (3), WMX (1).
- Triple Crown Series draft room: CAN 250 (2), CAN 450 (2), CAN WMX (1).
- MotoGP draft room: MotoGP (3).
- F1 draft room: F1 (3).
- Total maximum roster size is 26 athletes per team.

SCHEDULE AND SCORING EVENT TYPES
- Schedule event types include SMX, Triple Crown Series, MXGP, MotoGP, F1, and MXON.
- The Triple Crown Series scoring selection offers separate CAN 250, CAN 450, and CAN WMX divisions. CAN 250 and CAN 450 results contribute to the SMX standings bucket; CAN WMX results contribute to MXGP.
- WMX is included with MXGP series riders. USA WMX and SMX Next are included in the SMX group.
- MXON is a special schedule/scoring event type. Its athlete picker includes riders with SMX, CAN 250 / CAN 450 / CAN WMX, or MXGP / MX2 / WMX primary/secondary affiliations. MXON results are attributed to each rider's primary-series standings bucket.
- Rider primary and secondary series affiliations are saved in the existing athlete and roster data records; no new database category or migration reset is required.


TRIPLE CROWN SERIES UPDATE
- Triple Crown Series is its own schedule/scoring category and its own snake-draft room.
- Its divisions are CAN 250, CAN 450, and CAN WMX.
- Roster requirements remain CAN 250: 2, CAN 450: 2, CAN WMX: 1.
- Older saved CAN draft picks and draft settings are migrated to the Triple Crown Series room on startup. Legacy CAN schedule events and scoring records are displayed and editable as Triple Crown Series.
- Legacy CAN schedule events and scoring groups are treated as Triple Crown Series for filtering and editing.
- Triple Crown CAN 250/450 results contribute to SMX team category points; CAN WMX results contribute to MXGP team category points.
- MXON athlete selection includes riders primarily or secondarily affiliated with SMX, Triple Crown divisions, or MXGP divisions.

- Draft room and scoring eligibility can recognize either a rider's primary or secondary division affiliation; roster quota accounting always uses primary series only. A rider is still assigned to only one fantasy team across all rooms.
