const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForServer(baseUrl, child) {
  const deadline = Date.now() + 8000;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Test server exited early: ${child.output}`);
    try {
      const response = await fetch(`${baseUrl}/healthz`, { cache: 'no-store' });
      if (response.ok) return;
    } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Test server did not start: ${lastError?.message || child.output}`);
}

async function startServer(dataDir, port) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      DATA_DIR: dataDir,
      COMMISSIONER_PASSWORD: 'season-test-password',
      GITHUB_TOKEN: '',
      GITHUB_REPOSITORY: '',
      GITHUB_AUTO_BACKUP: 'false'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.output = '';
  child.stdout.on('data', chunk => { child.output += chunk.toString(); });
  child.stderr.on('data', chunk => { child.output += chunk.toString(); });
  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForServer(baseUrl, child);
  return { child, baseUrl };
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise(resolve => child.once('exit', resolve)),
    new Promise(resolve => setTimeout(resolve, 2000))
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, { cache: 'no-store', ...options });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

(async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kf-season-api-'));
  const port = await freePort();
  let processInfo;
  try {
    processInfo = await startServer(dataDir, port);
    let { baseUrl } = processInfo;

    let result = await jsonRequest(`${baseUrl}/api/historical`);
    assert.equal(result.response.status, 401, 'historical data must require commissioner authentication');

    result = await jsonRequest(`${baseUrl}/server.js`);
    assert.equal(result.response.status, 404, 'server source and default configuration must not be served publicly');

    const login = await jsonRequest(`${baseUrl}/api/commissioner/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'season-test-password' })
    });
    assert.equal(login.response.status, 200);
    const token = login.body.token;
    assert.ok(token);

    const oldState = {
      kaiserFantasyAthletes: [{ id: 'rider-1', name: 'Historic Rider', number: '18', class: 'MXGP', raceTeam: 'Old Factory Team' }],
      kaiserFantasyTeams: [{ key: 'team-1', name: 'Team One', owner: 'Owner', passwordHash: 'keep-me', roster: [{ id: 'rider-1', name: 'Historic Rider' }] }],
      kaiserFantasyScores: [{ id: 'score-1', riderId: 'rider-1', riderName: 'Historic Rider', riderClass: 'MXGP', series: 'MXGP', event: 'Great Britain', round: 8, points: 25, seasonYear: 2027 }],
      kaiserFantasyTrades: [{ id: 'trade-1' }],
      kaiserFantasyDraftState: { picks: [{ id: 'pick-1' }] },
      kaiserFantasyDraftSettings: { MXGP: { status: 'Complete' } },
      kaiserFantasySchedule: [{ id: 'event-1', name: 'Great Britain', date: '2027-06-01' }],
      kaiserFantasySeasonSettings: { currentYear: 2027 }
    };
    result = await jsonRequest(`${baseUrl}/api/state`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: oldState })
    });
    assert.equal(result.response.status, 200);

    const history = {
      version: 1,
      seasons: {
        '2027': { year: 2027, status: 'archived', archived: true, archivedAt: '2027-12-01T12:00:00.000Z', state: oldState }
      }
    };
    const nextState = {
      ...oldState,
      kaiserFantasyTeams: oldState.kaiserFantasyTeams.map(team => ({ ...team, roster: [] })),
      kaiserFantasyScores: [],
      kaiserFantasyTrades: [],
      kaiserFantasyDraftState: { picks: [] },
      kaiserFantasyDraftSettings: {},
      kaiserFantasySchedule: [],
      kaiserFantasySeasonSettings: { currentYear: 2028 }
    };
    result = await jsonRequest(`${baseUrl}/api/historical/archive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ year: 2027, history, nextState })
    });
    assert.equal(result.response.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.archivedYear, 2027);
    assert.equal(result.body.currentYear, 2028);

    result = await jsonRequest(`${baseUrl}/api/state`);
    assert.equal(result.body.state.kaiserFantasySeasonSettings.currentYear, 2028);
    assert.deepEqual(result.body.state.kaiserFantasyScores, [], 'points must not carry into the new season');
    assert.deepEqual(result.body.state.kaiserFantasySchedule, [], 'the next season schedule starts empty');
    assert.ok(!Object.hasOwn(result.body.state, 'kaiserFantasyHistoricalSeasons'), 'public API must not expose private historical seasons');
    assert.deepEqual(result.body.state.kaiserFantasyTeams[0].roster, [], 'team rosters must reset');
    assert.equal(result.body.state.kaiserFantasyTeams[0].passwordHash, 'keep-me', 'team ownership credentials remain intact');

    result = await jsonRequest(`${baseUrl}/api/state`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: { ...nextState, kaiserFantasyHistoricalSeasons: { seasons: {} } } })
    });
    assert.equal(result.response.status, 200);
    result = await jsonRequest(`${baseUrl}/api/historical`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(result.body.value.seasons['2027'].state.kaiserFantasyAthletes[0].number, '18', 'ordinary public saves cannot overwrite private history');
    assert.equal(result.body.value.seasons['2027'].state.kaiserFantasyAthletes[0].raceTeam, 'Old Factory Team');

    const diskPath = path.join(dataDir, 'league-data.json');
    const disk = JSON.parse(await fs.readFile(diskPath, 'utf8'));
    assert.equal(disk.state.kaiserFantasyHistoricalSeasons.seasons['2027'].state.kaiserFantasyScores[0].points, 25);
    assert.equal(disk.state.kaiserFantasySeasonSettings.currentYear, 2028);

    await stopServer(processInfo.child);
    processInfo = await startServer(dataDir, port);
    baseUrl = processInfo.baseUrl;
    const reLogin = await jsonRequest(`${baseUrl}/api/commissioner/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'season-test-password' })
    });
    assert.equal(reLogin.response.status, 200);
    result = await jsonRequest(`${baseUrl}/api/historical`, { headers: { Authorization: `Bearer ${reLogin.body.token}` } });
    assert.equal(result.body.value.seasons['2027'].state.kaiserFantasyAthletes[0].number, '18', 'archive survives server restart');

    console.log('Season API tests passed: private history auth, single-save archive/new-season transaction, no point carryover, public-state isolation, team preservation and disk persistence.');
  } finally {
    if (processInfo?.child) await stopServer(processInfo.child);
    await fs.rm(dataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
