// Append-only event log + in-memory projection, persisted in SQLite.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { reduce, sessionKey } from './reduce.js';

export class Store {
  constructor(path = ':memory:') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        key TEXT NOT NULL,
        type TEXT NOT NULL,
        body TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS events_key ON events (key, id);
    `);
    this.insert = this.db.prepare('INSERT INTO events (ts, key, type, body) VALUES (?, ?, ?, ?)');
    this.sessions = new Map();
    this.seqs = new Map(); // `${session}|${source}` -> highest sequence accepted
    this.receipts = new Set(); // `${session}|${event id}` already applied
    this.listeners = new Set();
    this.rebuild();
  }

  // Replay the whole log. Cheap at personal scale and keeps the projection honest.
  rebuild() {
    this.sessions.clear();
    this.seqs.clear();
    this.receipts.clear();
    for (const row of this.db.prepare('SELECT body FROM events ORDER BY id').iterate()) {
      const ev = JSON.parse(row.body);
      if (ev.late) continue;
      const key = sessionKey(ev);
      if (ev.eid) this.receipts.add(`${key}|${ev.eid}`);
      this.inOrder(key, ev);
      this.sessions.set(key, reduce(this.sessions.get(key), ev));
    }
  }

  // Reporters that number their events (the hook bridge, remote senders) get
  // out-of-order protection: a report whose sequence is not higher than the
  // last one accepted from the same source is recorded but never applied.
  inOrder(key, ev) {
    if (ev.seq == null) return true;
    const k = `${key}|${ev.source || ''}`;
    const last = this.seqs.get(k);
    if (last != null && ev.seq <= last) return false;
    this.seqs.set(k, ev.seq);
    return true;
  }

  append(ev) {
    const key = sessionKey(ev);
    // Idempotent ingestion: an event that names itself is applied once, however
    // many times it is delivered. The event row is its own receipt.
    if (ev.eid) {
      const receipt = `${key}|${ev.eid}`;
      if (this.receipts.has(receipt)) return this.sessions.get(key);
      this.receipts.add(receipt);
    }
    if (!this.inOrder(key, ev)) {
      this.insert.run(ev.ts, key, ev.type, JSON.stringify({ ...ev, late: true }));
      return this.sessions.get(key);
    }
    this.insert.run(ev.ts, key, ev.type, JSON.stringify(ev));
    const prev = this.sessions.get(key);
    const next = reduce(prev, ev);
    this.sessions.set(key, next);
    for (const fn of this.listeners) fn(next, prev, ev);
    return next;
  }

  get(key) {
    return this.sessions.get(key);
  }

  list() {
    return [...this.sessions.values()];
  }

  events(key, limit = 200) {
    return this.db
      .prepare('SELECT id, body FROM events WHERE key = ? ORDER BY id DESC LIMIT ?')
      .all(key, limit)
      .map((r) => ({ id: r.id, ...JSON.parse(r.body) }))
      .reverse();
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  close() {
    this.db.close();
  }
}
