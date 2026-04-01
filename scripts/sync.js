/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const LAB_ROOT = path.join(__dirname, '..');
const DB_PATH = path.join(LAB_ROOT, 'data', 'db.json');
const LEDGER_PATH = path.join(LAB_ROOT, 'data', 'ledger.json');
const PORTFOLIO_ROOT = path.join(LAB_ROOT, '..', 'codechitti216.github.io');
const PORTFOLIO_SNAPSHOT_PATH = path.join(
  PORTFOLIO_ROOT,
  'src',
  'data',
  'labSnapshot.json',
);

const RESEARCH_LAB_PUBLIC_URL = 'https://codechitti216.github.io/research-lab/';
const RESEARCH_LAB_REPO_URL = 'https://github.com/codechitti216/research-lab';

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

function normalizeTrackTag(track) {
  const normalized = String(track || '').trim().toLowerCase();
  if (normalized.includes('math')) return 'Math';
  if (normalized.includes('code')) return 'Code';
  return 'Code';
}

function toISO(dateLike) {
  if (!dateLike) return null;
  const value = new Date(dateLike);
  if (Number.isNaN(value.getTime())) return null;
  return value.toISOString();
}

function readLedger() {
  if (!fs.existsSync(LEDGER_PATH)) {
    return [];
  }

  const data = readJson(LEDGER_PATH);
  return Array.isArray(data) ? data : [];
}

function isTaskCompletionEntry(entry) {
  const eventKind = String(entry?.eventKind || '').trim().toLowerCase();
  const toStatus = String(entry?.toStatus || '').trim().toLowerCase();
  return eventKind.endsWith('_complete') || toStatus === 'checked';
}

function getEntryTimestamp(entry) {
  return toISO(entry?.timestamp || entry?.at);
}

function deriveTaskTitle(entry) {
  const explicit = String(entry?.clickedSubjectLabel || '').trim();
  if (explicit) return explicit;

  const title = String(entry?.title || '').trim();
  if (!title) return '';

  const bracketMatch = title.match(/\[([^\]]+)\]/);
  if (bracketMatch?.[1]) {
    return bracketMatch[1].trim();
  }

  const parentMatch = title.match(/\(([^)]+)\)\s*$/);
  if (parentMatch?.[1]) {
    return parentMatch[1].trim();
  }

  return '';
}

function deriveTopicTitle(entry, dbById) {
  const explicit = String(entry?.topicTitle || '').trim();
  if (explicit) return explicit;

  const dbTopic = dbById.get(entry?.cardId);
  if (dbTopic?.title) {
    return String(dbTopic.title).trim();
  }

  const title = String(entry?.title || '').trim();
  if (!title) return '';

  const colonIndex = title.indexOf(':');
  const chevronIndex = title.indexOf('>');
  const emDashIndex = title.indexOf('-');
  const splitIndex = [colonIndex, chevronIndex, emDashIndex]
    .filter((index) => index > 0)
    .sort((a, b) => a - b)[0];

  return splitIndex > 0 ? title.slice(0, splitIndex).trim() : title;
}

function buildPortfolioSnapshot(dbEntries, ledgerEntries) {
  const activeDbEntries = Array.isArray(dbEntries)
    ? dbEntries.filter((entry) => !entry?.archived)
    : [];
  const dbById = new Map();

  for (const entry of activeDbEntries) {
    if (entry?.id) {
      dbById.set(entry.id, entry);
    }
  }

  const latestCompletion = [...ledgerEntries]
    .filter(isTaskCompletionEntry)
    .sort((a, b) => new Date(getEntryTimestamp(b) || 0) - new Date(getEntryTimestamp(a) || 0))[0];

  return {
    latestActivity: latestCompletion
      ? {
          topicTitle: deriveTopicTitle(latestCompletion, dbById),
          taskTitle: deriveTaskTitle(latestCompletion),
          completedAt: getEntryTimestamp(latestCompletion),
          track: normalizeTrackTag(
            latestCompletion.track || dbById.get(latestCompletion.cardId)?.track || 'Code',
          ),
        }
      : null,
    githubUrl: RESEARCH_LAB_REPO_URL,
    openResearchLedgerUrl: RESEARCH_LAB_PUBLIC_URL,
    syncedAt: new Date().toISOString(),
  };
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

  const ledger = readLedger();
  const snapshot = buildPortfolioSnapshot(db, ledger);

  writeJson(PORTFOLIO_SNAPSHOT_PATH, snapshot);

  console.log('Wrote labSnapshot.json to portfolio repo:', PORTFOLIO_SNAPSHOT_PATH);
  console.log(JSON.stringify(snapshot, null, 2));
}

if (require.main === module) {
  main();
}
