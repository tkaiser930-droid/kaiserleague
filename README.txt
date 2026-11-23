KAISER FAMILY FANTASY SMX — GITHUB-ONLY / NODE.JS PROJECT

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

GITHUB-ONLY STORAGE / RENDER DEPLOYMENT
- GitHub is the only shared persistent store for league data. Default repository: tkaiser930-droid/LeagueSave. Each season is stored in league-data/seasons/YYYY.json, with league-data/season-index.json tracking active and archived years.
- The Node server loads the active season from GitHub into memory at startup and commits each accepted change directly back to that season file. The former league-data/league-data.json path is used only for one-time migration if the active season file does not yet exist.
- No Render persistent disk or local server-side league-data JSON file is used. The Render service hosts the website and API only.
- In Render > Service > Environment, set GITHUB_TOKEN, GITHUB_REPOSITORY=tkaiser930-droid/LeagueSave, GITHUB_BACKUP_PASSWORD, COMMISSIONER_PASSWORD, COMMISSIONER_SESSION_SECRET, GITHUB_BRANCH (blank for default), GITHUB_DATA_PATH=league-data/league-data.json (legacy migration only), GITHUB_SEASON_DIRECTORY=league-data/seasons, GITHUB_SEASON_INDEX_PATH=league-data/season-index.json, and KF_ACTIVE_SEASON=2027. The token needs Contents: Read and write and Metadata: Read.
- Do not set DATA_DIR. The included render.yaml no longer declares a persistent disk.
- Before deploying this update from the former disk-based version, first use the current live site’s Commissioner > Data & Backup > Save Current League JSON to GitHub. Confirm the GitHub commit and download a JSON backup. Only then deploy and remove the old Render persistent disk.
- Manual portable JSON download and restore remain available in Data & Backup. When GitHub is offline, the browser copy can still be downloaded; server-side shared saving reports an error rather than falling back to a Render disk.
- For Docker deployment, use the included Dockerfile; no persistent disk is required.

LOCAL DEVELOPMENT
- Install Node.js 22 or newer.
- Copy .env.example to .env and configure the GitHub token/repository/password for shared saving.
- Run npm install and npm start.
- Open the URL printed by the server (normally http://127.0.0.1:10000/).
- Without a configured GitHub token, the site intentionally uses browser-only storage. The portable JSON download is still available; no local server-side league-data file is created.

DATA SAFETY
- Download a league backup from Data & Backup before deploying updates, importing old data, or resetting the league.
- The GitHub repository is the only shared persistent source of truth. Browser localStorage retains a local working copy and supports portable backup downloads.
- The server writes each accepted change directly to GitHub. If GitHub rejects a save, the browser copy is retained and the save failure is surfaced; there is no Render/local-file fallback.

BACKGROUND AND BRANDING
- The enhanced motocross action image remains at assets/site-background.webp and is applied across every page.
- Manufacturer logos and colors from the GASGAS-logo version remain. Later sponsor-only badge entries have been removed as part of this rollback.

SECURITY
- Historical season state and season editing APIs require a commissioner session. Public athlete-history responses contain only selected athlete details and scored results; team passwords, ownership credentials, trades and draft data are not exposed.
- Keep the LeagueSave repository private. GitHub repository permissions are separate from the website commissioner login.
- Set a strong COMMISSIONER_PASSWORD and COMMISSIONER_SESSION_SECRET in Render environment variables; do not commit either value.

COMMISSIONER DASHBOARD NAVIGATION
- The Commissioner page is organized into Athletes, Scoring, Draft, Schedule, Historical Results, and Data & Backup tabs. A commissioner-only season dropdown selects the independent workspace to edit or score; it offers seasons from 2010 onward.
- Historical Results shows rider totals, unique event-round counts, and average points per round grouped by rider, series, and class. Previous-season workspaces are commissioner-only; public rider profiles expose only sanitized results from archived seasons.
- Archive Current Season marks the active year as archived and starts the next year with the rider directory and team identities but no rosters, scores, trades, draft, or schedule.
- Riders and schedules can be copied between season files; copied rider numbers and race teams are season-specific, and copied schedule dates move to the destination year.
- Each year has its own GitHub JSON file at league-data/seasons/YYYY.json; league-data/season-index.json tracks the active year and archive status.
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

GITHUB-ONLY SAVING
- See GITHUB-BACKUP-SETUP.txt for token permissions, the one-time migration from the former Render-disk version, and local JSON download/restore instructions.


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


Historical season files
-----------------------
The commissioner dashboard provides season workspaces from 2010 through the active year. Each year has its own GitHub file under league-data/seasons/YYYY.json; league-data/season-index.json records the active year and archived status. The active year defaults to 2027 and can be changed with KF_ACTIVE_SEASON before the index is initialized.

Only the active season is served to public team, draft, schedule and current standings endpoints. Accessing any previous-year workspace requires a commissioner session cookie. The public athlete profile API returns a sanitized subset of archived rider results and per-series/class average points; it does not return historical team passwords, owner details, trades or draft information. Keep the LeagueSave repository private because it contains the underlying season save files.

Archive Current Season saves the year snapshot, carries forward independent copies of the rider directory and team identities, and creates the next year without rosters, scores, trades, draft state or schedule. Copy Between Seasons can copy rider records or schedule events to the selected year. Local JSON backup download and restore apply to the currently selected year.


COMMISSIONER TABLE FILTERS
--------------------------
Commissioner > Athletes includes live search by athlete name, number, race team, manufacturer, country/region, series affiliation and owner, plus series and fantasy-owner dropdowns. Series filtering includes secondary-series affiliations. Commissioner > Schedule includes live search, series, event-type and year filters. The scheduled-event edit dropdown follows the same active filters. Clear Filters resets each section. These are view-only controls and do not alter or save league data.
