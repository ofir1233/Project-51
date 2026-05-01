import Database from 'better-sqlite3';
import { paths } from './paths.mjs';

let _db = null;

export function db() {
  if (_db) return _db;
  _db = new Database(paths.dbFile);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  _db.pragma('synchronous = NORMAL');
  return _db;
}

export function closeDb() {
  if (_db) { _db.close(); _db = null; }
}
