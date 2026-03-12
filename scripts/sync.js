/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const LAB_ROOT = path.join(__dirname, '..');
const DB_PATH = path.join(LAB_ROOT, 'data', 'db.json');
const LEDGER_PATH = path.join(LAB_ROOT, 'data', 'ledger.json');
const PORTFOLIO_ROOT = path.join(LAB_ROOT, '..', 'codechitti216.github.io');
const PORTFOLIO_KANBAN_PATH = path.join(
  PORTFOLIO_ROOT,
  'src',
  'data',
  'kanban.json',
);
const PORTFOLIO_STORY_LINKS_PATH = path.join(
  PORTFOLIO_ROOT,
  'src',
  'data',
  'storyLinks.json',
);
const PORTFOLIO_STORIES_DIR = path.join(
  PORTFOLIO_ROOT,
  'src',
  'pages',
  'stories',
);

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function writeJson(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function normalizeStatus(status) {
  const s = String(status || '').trim().toLowerCase();
  if (s.startsWith('hyp')) return 'hypothesis';
  if (s.startsWith('sand')) return 'sandboxing';
  if (s.startsWith('res')) return 'resolved';
  return s || 'hypothesis';
}

function normalizeTrackTag(track) {
  const t = String(track || '').trim().toLowerCase();
  if (t.includes('math')) return 'Math';
  if (t.includes('code')) return 'Code';
  return 'Code';
}

function toISO(dateLike) {
  if (!dateLike) return null;
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function getDateKey(dateLike) {
  const iso = toISO(dateLike);
  return iso ? iso.slice(0, 10) : null;
}

function getWeekStart(dateLike) {
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.getDay(); // 0-6, Sunday = 0
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday start
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function computeSidewaysStreaks(entries) {
  // Sideways = movements between non-resolved states (Hypothesis <-> Sandboxing)
  const perTrackDays = new Map(); // track -> Set<YYYY-MM-DD>

  for (const entry of entries) {
    const track = normalizeTrackTag(entry.track);
    const history = Array.isArray(entry.history) ? entry.history : [];
    for (let i = 1; i < history.length; i += 1) {
      const prev = normalizeStatus(history[i - 1].status);
      const curr = normalizeStatus(history[i].status);
      if (prev === curr) continue;
      if (prev === 'resolved' || curr === 'resolved') continue;
      const key = getDateKey(history[i].at);
      if (!key) continue;
      if (!perTrackDays.has(track)) perTrackDays.set(track, new Set());
      perTrackDays.get(track).add(key);
    }
  }

  function longestStreak(daySet) {
    if (!daySet || !daySet.size) return 0;
    const days = Array.from(daySet).sort();
    let best = 1;
    let current = 1;
    for (let i = 1; i < days.length; i += 1) {
      const prev = new Date(days[i - 1]);
      const curr = new Date(days[i]);
      const diff = (curr - prev) / (1000 * 60 * 60 * 24);
      if (diff === 1) {
        current += 1;
        if (current > best) best = current;
      } else {
        current = 1;
      }
    }
    return best;
  }

  const result = {};
  for (const [track, daySet] of perTrackDays.entries()) {
    result[track] = {
      activeDays: daySet.size,
      longestStreak: longestStreak(daySet),
    };
  }
  return result;
}

function buildKanbanPayload(entries) {
  const tasks = [];

  for (const entry of entries) {
    const history = Array.isArray(entry.history) ? entry.history : [];
    const lastMovement = history[history.length - 1] || {};
    const status = normalizeStatus(lastMovement.status || entry.status);
    const track = normalizeTrackTag(entry.track);
    const updatedAt =
      toISO(lastMovement.at) || toISO(entry.updatedAt) || new Date().toISOString();

    tasks.push({
      id: entry.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      title: entry.title || 'Untitled',
      status,
      track,
      updatedAt,
    });
  }

  return tasks;
}

function readLedger() {
  if (!fs.existsSync(LEDGER_PATH)) {
    return [];
  }
  const data = readJson(LEDGER_PATH);
  return Array.isArray(data) ? data : [];
}

function buildStoryPageForToday(ledgerEntries) {
  const today = new Date();
  const todayKey = today.toISOString().slice(0, 10); // YYYY-MM-DD
  const todaysEntries = ledgerEntries.filter((entry) => {
    const key = getDateKey(entry.timestamp);
    return key === todayKey;
  });

  ensureDir(PORTFOLIO_STORIES_DIR);

  const filePath = path.join(PORTFOLIO_STORIES_DIR, `${todayKey}.jsx`);
  const verificationTimestamp = new Date().toISOString();

  const serializedEntries = JSON.stringify(todaysEntries, null, 2);

  const contents = `import React from 'react';

const entries = ${serializedEntries};
const verificationTimestamp = '${verificationTimestamp}';
const storyDate = '${todayKey}';

export default function StoryFor${todayKey.replace(/-/g, '_')}() {
  return (
    <main className="max-w-3xl mx-auto py-10 px-4 space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Story of the Day – {storyDate}</h1>
        <p className="text-sm text-gray-600">
          A narrative of how hypotheses and sandboxes moved across the board today.
        </p>
      </header>

      {entries.length === 0 ? (
        <p className="text-sm text-gray-500">
          No movements were recorded in the Local Research Lab for this date.
        </p>
      ) : (
        <section className="space-y-4">
          <ol className="border-l border-gray-300 pl-4 space-y-4">
            {entries.map((entry, index) => (
              <li key={index} className="relative">
                <div className="absolute -left-2 top-1 h-3 w-3 rounded-full bg-emerald-500 border border-emerald-700" />
                <div className="space-y-1">
                  <div className="text-xs text-gray-500 font-mono">
                    {new Date(entry.timestamp).toLocaleString()}
                  </div>
                  <div className="text-sm font-semibold">
                    {entry.title}{' '}
                    <span className="text-xs font-normal text-gray-500">
                      ({entry.cardId || 'no-id'})
                    </span>
                  </div>
                  <div className="text-xs text-gray-700">
                    <span className="font-medium">{entry.fromStatus}</span>
                    {' \u2192 '}
                    <span className="font-medium">{entry.toStatus}</span>
                  </div>
                  {entry.comment && (
                    <p className="text-sm text-gray-800 whitespace-pre-wrap">
                      {entry.comment}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      <footer className="pt-4 text-xs text-gray-500 border-t border-gray-200">
        This progress was verified and pushed from the Local Research Lab at {verificationTimestamp}.
      </footer>
    </main>
  );
}
`;

  fs.writeFileSync(filePath, contents, 'utf8');
  return { filePath, storyDate: todayKey };
}

function buildStoryLinks(ledgerEntries, dbEntries) {
  const byId = new Map();
  for (const entry of dbEntries) {
    if (entry.id) {
      byId.set(entry.id, entry);
    }
  }

  const links = {
    Math: {},
    Code: {},
  };

  for (const entry of ledgerEntries) {
    const from = normalizeStatus(entry.fromStatus);
    const to = normalizeStatus(entry.toStatus);
    if (!from || !to) continue;
    // Sideways win = non-resolved -> non-resolved with a change
    if (from === to) continue;
    if (from === 'resolved' || to === 'resolved') continue;

    let track = null;
    if (entry.track) {
      track = normalizeTrackTag(entry.track);
    } else if (entry.cardId && byId.has(entry.cardId)) {
      track = normalizeTrackTag(byId.get(entry.cardId).track);
    }
    if (!track || !links[track]) continue;

    const ts = entry.timestamp || entry.at;
    const dayKey = getDateKey(ts);
    if (!dayKey) continue;

    const weekStart = getWeekStart(ts);
    if (!weekStart) continue;
    const weekKey = weekStart.toISOString().slice(0, 10);

    const existing = links[track][weekKey];
    if (!existing || dayKey < existing) {
      // Keep the earliest story date for that week+track
      links[track][weekKey] = dayKey;
    }
  }

  writeJson(PORTFOLIO_STORY_LINKS_PATH, links);
  return links;
}

function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`Missing db.json at ${DB_PATH}`);
    process.exit(1);
  }

  const db = readJson(DB_PATH);
  if (!Array.isArray(db)) {
    console.error('db.json must be an array of entries.');
    process.exit(1);
  }

  const streaks = computeSidewaysStreaks(db);
  const kanban = buildKanbanPayload(db);
  const ledger = readLedger();

  // Build story of the day + links based on the ledger.
  const storyInfo = buildStoryPageForToday(ledger);
  const storyLinks = buildStoryLinks(ledger, db);

  writeJson(PORTFOLIO_KANBAN_PATH, kanban);

  console.log('Wrote kanban.json to portfolio repo:', PORTFOLIO_KANBAN_PATH);
  console.log('Sideways streaks (#Math vs #Code):');
  console.log(JSON.stringify(streaks, null, 2));
  console.log('Story page generated:', storyInfo.filePath);
  console.log('Story links (per track/week):');
  console.log(JSON.stringify(storyLinks, null, 2));
}

if (require.main === module) {
  main();
}


