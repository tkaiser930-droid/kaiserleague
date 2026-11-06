KAISER FAMILY FANTASY SMX — RENDER / NODE.JS PROJECT

This package restores the league's core structure to the version from the GASGAS-logo update, while retaining the requested additions: the site-wide motocross background, Triple Crown Series with CAN 250 and CAN 450, primary/secondary rider affiliations, MXON, and the Reigning Triple Crown Champion checkbox and number-plate color.

ROSTER / DRAFT STRUCTURE
- SMX draft room: 250 (3), 450 (3). SMX Next is not an active division.
- Triple Crown Series draft room: CAN 250 (2), CAN 450 (2).
- MXGP draft room: MXGP (3), MX2 (3).
- MotoGP draft room: MotoGP (3).
- F1 draft room: F1 (3).
- Total: 22 primary-series roster spots per team.
- Riders may have multiple secondary affiliations. Only the Primary Series counts toward team roster limits and quotas.
- A rider may belong to only one fantasy team across all draft rooms.

REMOVED SERIES
- All WMX divisions and SMX Next are removed from active rider, roster, draft, and scoring choices.
- F2, F3, Moto2, Moto3, and F1 Academy are removed as separate classes.
- Existing F2/F3/F1 Academy primary riders migrate into F1; existing Moto2/Moto3 primary riders migrate into MotoGP.
- WMX-only and SMX Next-only riders are archived in the athlete database and released from active rosters; if either has a valid retained secondary affiliation, that affiliation is promoted to Primary Series. Their old scoring records are retained as archived history.
- Existing teams with multiple former F2/F3/F1 Academy riders or Moto2/Moto3 riders may exceed the new F1/MotoGP quota after migration. Their rosters are preserved; review and drop excess riders through Team Management.

TRIPLE CROWN SERIES
- Triple Crown Series is its own schedule/scoring category and its own snake-draft room.
- Divisions: CAN 250 and CAN 450. Roster requirements: 2 each.
- Triple Crown Series scoring bonuses: Fastest qualifier (+2), Moto 1 winner (+5), Moto 2 winner (+5), Fastest lap (+1).
- TCS team standings appear as “TCS Points”. TCS scores remain separate from SMX and MXGP standings.
- Reigning Triple Crown Champion is available on Add Athlete and Edit Rider and receives gold numbers on a purple plate. Current Points Leader (white on red) remains the highest-priority number color.

MXON
- MXON remains a special schedule/scoring event.
- Eligible athletes include riders with primary or secondary affiliation in 250, 450, CAN 250, CAN 450, MXGP, or MX2.
- MXON points are credited to the rider's primary-series standings bucket (SMX, TCS, or MXGP).

SCHEDULE
- Event types: SMX, Triple Crown Series, MXGP, MotoGP, F1, and MXON.
- Events support single-day and multi-day date ranges, round numbers, country, optional sub-region, and event editing.
- Commissioner can select a scheduled event from a dedicated Edit Scheduled Event control or use the Edit Scheduled Event button in that event row. Editing loads the saved event details into the schedule form; saving updates the existing event instead of creating a duplicate.
- Triple Crown Series schedule badge uses forest green. MXON uses blue.
- Team Management and Trade Center lock during scheduled event dates.

RENDER DEPLOYMENT
Recommended: Render native Node runtime. Build command: npm install. Start command: npm start. Health Check Path: /healthz. Set DATA_DIR=/var/data and attach the existing persistent disk at /var/data. Do not remove or reformat the disk; it contains the live league database.

For Docker runtime, the package includes Dockerfile at the project root. Set Dockerfile Path to ./Dockerfile and attach the same persistent disk at /var/data.

LOCAL DEVELOPMENT
- Install Node.js 22 or newer.
- Open this folder in VS Code.
- Run npm start.
- Open http://127.0.0.1:5500/.
- The local database is stored under data/league-data.json.

DATA SAFETY
- Existing league data is not reset by this package.
- Startup migration maps old class names to their retained parent where appropriate, archives WMX-only and SMX Next-only riders instead of deleting athlete records, removes archived riders from active rosters, and retains historic scores.
- Download a league backup from Data & Backup before deploying any update.

BACKGROUND AND BRANDING
- The enhanced motocross action image remains at assets/site-background.webp and is applied across every page.
- Manufacturer logos and colors from the GASGAS-logo version remain. Later sponsor-only badge entries have been removed as part of this rollback.

SECURITY
The existing login and data API were originally designed for a private family league prototype. Server-side role authorization should be added before allowing untrusted public users to modify league data.
