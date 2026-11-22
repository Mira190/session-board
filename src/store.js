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
    this.listeners = new Set();
    this.rebuild();
  }

  // Replay the whole log. Cheap at personal scale and keeps the projection honest.
  rebuild() {
    this.sessions.clear();
    for (const row of this.db.prepare('SELECT body FROM events ORDER BY id').iterate()) {
      const ev = JSON.parse(row.body);
      const key = sessionKey(ev);
      this.sessions.set(key, reduce(this.sessions.get(key), ev));
    }
  }

  append(ev) {
    const key = sessionKey(ev);
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
