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
- MXON remains a special schedule/scoring event and does not create a primary roster class or roster quota.
- MXON MXGP, MXON MX2, and MXON Open are secondary-only athlete affiliations, selectable when adding or editing a rider.
- Scoring has six tabs: MX2 Qualifying Race, MXGP Qualifying Race, Open Qualifying Race, Moto 1, Moto 2, and Moto 3.
- MX2 Qualifying Race selects only MXON MX2 riders; MXGP Qualifying Race selects only MXON MXGP riders; Open Qualifying Race selects only MXON Open riders.
- Moto 1 selects MXON MXGP and MXON MX2 riders; Moto 2 selects MXON MX2 and MXON Open riders; Moto 3 selects MXON MXGP and MXON Open riders.
- All six tabs have 40 rider positions and use the MXGP moto finish-points table (1st 25, 2nd 22, 3rd 20, 4th 18, 5th 16, then decreasing by one through 20th; 21st–40th receive 0 finish points).
- Qualifying Race bonuses: Fastest Lap (+1), Nation 1st Qualifying (+3), Nation 2nd Qualifying (+2), Nation 3rd Qualifying (+1).
- Moto bonuses: Fastest Lap (+1), Nation 1st (+10), Nation 2nd (+5), Nation 3rd (+3).
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

DATA SAFETY AND SEASON HISTORY
- Existing league data is not reset by this package. The original Node.js save remains in `data/league-data.json` locally or `/var/data/league-data.json` on Render; the GitHub mirror continues to store the same complete JSON database.
- The new `kaiserFantasySeasonSettings` key records the active season year. The private `kaiserFantasyHistoricalSeasons` key is stored inside the same database file and is excluded from the public `/api/state` response.
- Historical seasons are available in Commissioner > Historical Results from 2010 onward. Each year has its own riders, teams, results, scoring, draft and schedule state. The public site reads the active season only. Historical data requires a server-authenticated Commissioner session.
- Archiving is one server-side database transaction: the current year's full snapshot is retained privately, the next year becomes active, and that year's scores, trades, draft, rosters and schedule start empty. Rider directory data and team identity/passwords are carried forward. Points are never carried forward.
- Average points per round is calculated separately for each rider, series and class. Multiple scoring segments at the same scheduled event count as one round.
- Use the Commissioner season tools to copy rider records or a schedule into another year. Copied rider numbers, race teams and other metadata are season-specific; copied schedule dates move to the destination year and event IDs are regenerated to keep each season's results separate.
- The new archive is saved in the existing `league-data.json`, not a second database. Render's attached persistent disk and the automatic GitHub JSON backup continue to cover it. Keep the GitHub backup repository private because the full backup includes commissioner-only historical records.
- Startup migration maps old class names to their retained parent where appropriate, archives WMX-only and SMX Next-only riders instead of deleting athlete records, removes archived riders from active rosters, and retains historic scores.
- Download a league backup from Data & Backup before deploying any update.

BACKGROUND AND BRANDING
- The enhanced motocross action image remains at assets/site-background.webp and is applied across every page.
- Manufacturer logos and colors from the GASGAS-logo version remain. Later sponsor-only badge entries have been removed as part of this rollback.

SECURITY
- Historical records use a server-authenticated Commissioner session and a protected API. Public state reads and writes cannot read or overwrite the private historical key.
- Set `COMMISSIONER_PASSWORD` as a secret environment variable in Render. For local Node.js use, copy `.env.example` to `.env`, enter a unique password, and run `npm start`; Node 22 loads that file automatically. The legacy password remains as a compatibility fallback if the variable is not set; configure a unique password before exposing the service publicly.
- Keep the configured GitHub backup repository private: the mirrored database includes the private archive even though the website's public API does not expose it.

COMMISSIONER DASHBOARD NAVIGATION
- The Commissioner page is organized into Athletes, Scoring, Draft, Schedule, Historical Results, and Data & Backup tabs.
- The year selector changes the complete data workspace used by the Athletes, Scoring, Draft, and Schedule tabs. Historical workspaces are saved separately from the active season.
- Historical Results shows rider totals, rounds and average points by series/class, plus event/session scoring records. All years from 2010 are selectable; empty years are created as isolated workspaces.
- Copy Between Seasons can copy the rider directory or schedule from another season. Schedule dates shift to the destination year. Archive Current Season & Start Next Year creates a protected snapshot and resets the next season without deleting the old results.
- Athletes contains Add Athlete, Edit Rider, and All Athletes.
- Scoring contains Score Race Results, Previously Scored Events, and Scoring History.
- Draft contains Draft Management.
- Schedule contains Add Schedule Event, Edit Scheduled Event controls, and Scheduled Events.

SCHEDULE EVENT TYPES
- SMX secondary event types: Supercross, Motocross, and SMX. When Supercross is selected, choose East, West, or East/West in the additional Supercross Division field. The schedule displays Supercross East, Supercross West, or Supercross East/West.
- Triple Crown Series event types: Stage 1, Stage 2, and Stage 3.
- MXGP, MotoGP, and F1 each support Grand Prix as a secondary event type.
- F1 also supports Sprint as a secondary event type.

SCORING FORMATS
- Supercross: one 20-rider table. Finish points: 1st 25, 2nd 22, 3rd 20, 4th 18, 5th 16, then decrease by one point per place through 20th (1 point). Bonuses: Fastest Qualifier (+2), Heat Winner (+3), Fastest Lap (+1).
- Motocross (SMX event type) and Triple Crown Series: separate Moto 1 and Moto 2 tabs, each with 40 rider slots. Places 1–20 use the 20-place Supercross points table; places 21–40 receive 0 finish points but remain selectable for bonuses. Moto 1 bonuses: Fastest Qualifier (+2), Fastest Lap (+1). Moto 2 bonus: Fastest Lap (+1). Triple Crown Series does not apply a Stage 1/2/3 multiplier.
- MXGP: Qualifying Race, Moto 1, and Moto 2 tabs. Qualifying Race awards 10–1 points for 1st–10th and 0 points for 11th–40th, with no bonuses. Both Moto tabs use MXGP moto points and Fastest Lap (+1) only; MXGP Moto 1 does not award Fastest Qualifier.
- SMX event type: one 20-rider overall table using the Supercross points table. Round 1 uses normal points, Round 2 doubles the total score, and Round 3 triples the total score. The multiplier applies to placement points and selected bonuses. Bonuses: Fastest Qualifier (+2), Moto 1 Fastest Lap (+1), Moto 2 Fastest Lap (+1), Moto 1 Winner (+3), Moto 2 Winner (+3). Moto wins are bonuses only, not separate scoring tabs.
- F1 Grand Prix: one 22-rider Grand Prix table using the standard 22-place points table. Bonuses: Fastest Qualifier (+3), Fastest Lap (+1).
- F1 Sprint event: two scoring tabs, Grand Prix and Sprint. Grand Prix uses the standard F1 Grand Prix table. Sprint awards 8 points for 1st, then decreases by one point through 8th (1 point); 9th–22nd receive 0. Both tabs use Fastest Qualifier (+3) and Fastest Lap (+1).
- MotoGP: always has two scoring tabs, Grand Prix and Sprint. Grand Prix uses the standard 22-place points table. Sprint awards 12 points for 1st, 9 for 2nd, 7 for 3rd, then decreases by one point per place through 9th (1 point); 10th–22nd receive 0. Both tabs use Fastest Qualifier (+3) and Fastest Lap (+1).
- The scoring form derives event type from the selected schedule event. MotoGP always displays both tabs; F1 displays separate tabs only for scheduled Sprint events.

GITHUB + RENDER LEAGUE-DATA SYNC
- Render remains the live working database at /var/data/league-data.json. GitHub stores a second copy of that same JSON save at league-data/league-data.json by default; it does not replace the website source files.
- On every server startup, the server scans Render/local league-data.json and the GitHub JSON copy, compares their savedAt timestamps, and loads whichever save is newer. Render/local wins exact timestamp ties.
- Every update written to league-data.json automatically queues a GitHub commit after the file write settles. A file watcher also detects direct edits to the save JSON file and backs those up.
- Configure GITHUB_TOKEN, GITHUB_REPOSITORY (preconfigured as tkaiser930-droid/LeagueSave), GITHUB_BRANCH (leave blank to auto-detect the repository default branch), GITHUB_DATA_PATH (defaults to league-data/league-data.json), GITHUB_BACKUP_PASSWORD, and GITHUB_AUTO_BACKUP=true. The token needs Contents: Read and write and Metadata: Read. Use a fine-grained token restricted to tkaiser930-droid/LeagueSave.
- The first save can initialize an empty GitHub repository by creating the first tree, commit, and branch. Existing repositories use their default branch automatically unless GITHUB_BRANCH explicitly overrides it.
- For local development, copy .env.example to .env, fill in the token/password, and run npm start. On Render, confirm the existing GITHUB_REPOSITORY environment variable is exactly tkaiser930-droid/LeagueSave (an old environment value overrides the code default), set the secret token/password, and keep the persistent disk mounted at /var/data.
- Data & Backup displays Render and GitHub saved timestamps. Its “Scan GitHub & Render — Load Newest Save” control performs the same comparison manually. “Save Current League JSON to GitHub” forces a manual JSON backup. Enter GITHUB_BACKUP_PASSWORD for these manual actions.
- The existing “Save / Flush to Render or Local Server” button still flushes the live database to Render/local storage. “Download League Backup” and “Restore a Backup” remain the portable manual JSON export/import options.
- GITHUB_AUTO_BACKUP=false disables automatic GitHub writes but leaves startup comparison and protected manual GitHub save/sync actions available.
- Never put GITHUB_TOKEN in app.js, HTML, browser localStorage, or a committed file. The token is read only by server.js from environment variables or the untracked local .env file.


NAVIGATION AND TIME DISPLAY UPDATE
----------------------------------
The navigation is consolidated into Teams, Athletes, and Teams & Manufacturers. Team claiming and roster management are available on the Teams page. Athlete filters include all/available, series, and ownership. Race-team and manufacturer directories share dropdown filters. Data & Backup is embedded as a commissioner-only tab. Legacy page URLs redirect to their consolidated destinations.

All date/time interpretation and display in the website uses the America/Vancouver timezone. Draft planned starts entered in the commissioner datetime-local field are interpreted as Vancouver local time.
OFFICIAL RACE RESULTS IMPORT
----------------------------
The Commissioner > Scoring tab supports a preview-first official race-results importer. Paste an official result-table URL or upload an official CSV export. It matches rider names/numbers to the selected series and division, then loads matched finishing positions into the existing scoring grid for review. It never posts scores automatically. CSV files need Position and Rider (or Driver) columns; Number, Team, and Best Lap are optional.

URL fetching is handled by the Node server, so run the site with `npm start` rather than VS Code Live Server. The importer allowlists official domains per series and will refuse unrelated URLs. Some official sites require a sign-in or render their result tables dynamically; for those, download an official CSV export and upload it. The official MotoGP Fast Lap Rider PDF linked from the selected RAC / SPR session is a supported special case and is parsed server-side using `pdfjs-dist`; arbitrary PDF and Excel imports are not supported. See RESULTS-IMPORT-SETUP.txt for the source-domain list and details.


MXGP importer request correction (November 16, 2026)
- The final `reslists.aspx` request now retains hidden non-framework view parameters from the dropdown form when present, including `view=classification`. The previous final-URL builder cleared the whole query string and dropped this state after the dropdown selections; the corrected builder no longer strips it.
- Mismatch errors now include the exact selected dropdown labels and option values (Championship, Class, Round, Session) alongside the final source URL. This is intended to identify the actual portal option-value mapping if the live source still returns a different classification.
