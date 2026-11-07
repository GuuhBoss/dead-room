import { mkdirSync, statSync, readFileSync, renameSync, openSync, writeFileSync, fsyncSync, closeSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { playerName } from './protocol.mjs';

const LIMIT = 50, MAX_FILE = 1024 * 1024;
const integer = (v, min = 0) => Number.isSafeInteger(v) && v >= min;
const compare = (a, b) => b.score - a.score || b.kills - a.kills || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
function cleanEntry(entry) {
  if (!entry || typeof entry !== 'object' || !/^[a-f0-9-]{36}$/.test(entry.id)
    || !['solo', 'coop'].includes(entry.mode) || !integer(entry.roomIndex) || entry.roomIndex > 255
    || !Array.isArray(entry.names) || entry.names.length !== (entry.mode === 'solo' ? 1 : 2)
    || !entry.names.every(name => playerName(name) === name)
    || !['score', 'kills', 'level', 'bestMultiplier'].every(key => integer(entry[key], key === 'level' || key === 'bestMultiplier' ? 1 : 0))
    || !Number.isFinite(entry.duration) || entry.duration <= 0 || entry.duration > 6 * 60 * 60
    || typeof entry.createdAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(entry.createdAt) || !Number.isFinite(Date.parse(entry.createdAt))) return null;
  return Object.fromEntries(['id', 'names', 'score', 'kills', 'level', 'bestMultiplier', 'duration', 'roomIndex', 'mode', 'createdAt'].map(key => [key, key === 'names' ? [...entry.names] : entry[key]]));
}
function bounded(entries) {
  const counts = new Map(), ids = new Set();
  return entries.sort(compare).filter(entry => {
    const key = `${entry.roomIndex}:${entry.mode}`, count = counts.get(key) || 0;
    if (count >= LIMIT || ids.has(entry.id)) return false;
    ids.add(entry.id); counts.set(key, count + 1);
    return true;
  }).slice(0, 1000);
}

export class Leaderboard {
  constructor(dataDir = process.env.DATA_DIR || 'data') {
    this.directory = resolve(dataDir);
    this.file = join(this.directory, 'leaderboard.json');
    this.entries = [];
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    try {
      if (statSync(this.file).size > MAX_FILE) throw new Error('Oversized leaderboard');
      const parsed = JSON.parse(readFileSync(this.file, 'utf8'));
      if (parsed.version !== 1 || !Array.isArray(parsed.entries) || parsed.entries.length > 10000) throw new Error('Invalid leaderboard');
      this.entries = bounded(parsed.entries.map(cleanEntry).filter(Boolean));
    } catch (error) {
      if (error.code !== 'ENOENT') {
        // Keep one bounded backup; never fail startup or interpret corrupt scores.
        try { renameSync(this.file, join(this.directory, 'leaderboard.corrupt.json')); } catch { /* read-only disk: keep empty in memory */ }
        console.error('Leaderboard could not be loaded; starting empty.');
      }
    }
  }
  list({ roomIndex, mode } = {}) {
    return this.entries.filter(entry => (roomIndex === undefined || entry.roomIndex === roomIndex) && (mode === undefined || entry.mode === mode)).slice(0, LIMIT).map(entry => ({ ...entry, names: [...entry.names] }));
  }
  record(entry) {
    const cleaned = cleanEntry(entry);
    if (!cleaned) throw new TypeError('Invalid completed run');
    if (this.entries.some(previous => previous.id === cleaned.id)) return false;
    const next = bounded([...this.entries, cleaned]);
    const temporary = join(this.directory, `.leaderboard-${randomUUID()}.tmp`);
    let fd;
    try {
      fd = openSync(temporary, 'wx', 0o600);
      writeFileSync(fd, JSON.stringify({ version: 1, entries: next }) + '\n');
      fsyncSync(fd); closeSync(fd); fd = undefined;
      renameSync(temporary, this.file);
      this.entries = next;
      // Directory fsync persists the rename on filesystems that support it.
      let directoryFd;
      try { directoryFd = openSync(this.directory, 'r'); fsyncSync(directoryFd); } finally { if (directoryFd !== undefined) closeSync(directoryFd); }
      return true;
    } finally {
      if (fd !== undefined) closeSync(fd);
      try { unlinkSync(temporary); } catch { /* already renamed */ }
    }
  }
}
