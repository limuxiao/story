import { Injectable, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS stages (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  subtitle TEXT,
  weeks TEXT,
  goal TEXT,
  focus TEXT,
  sort_order INTEGER NOT NULL,
  module_ids TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS modules (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  subtitle TEXT,
  stage INTEGER NOT NULL,
  sort_order INTEGER NOT NULL,
  goal TEXT,
  overview TEXT,
  checklist TEXT DEFAULT '[]',
  dimensions TEXT DEFAULT '[]',
  target_words INTEGER DEFAULT 0,
  icon TEXT
);

CREATE TABLE IF NOT EXISTS lessons (
  id TEXT PRIMARY KEY,
  module_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  body TEXT NOT NULL,
  keypoints TEXT DEFAULT '[]',
  pitfalls TEXT DEFAULT '[]',
  drill TEXT,
  read_minutes INTEGER DEFAULT 8
);

CREATE TABLE IF NOT EXISTS exercises (
  id TEXT PRIMARY KEY,
  module_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  title TEXT NOT NULL,
  prompt TEXT NOT NULL,
  requirements TEXT DEFAULT '[]',
  min_words INTEGER DEFAULT 200,
  reference TEXT,
  rubric TEXT DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  module_id TEXT NOT NULL,
  exercise_id TEXT,
  title TEXT,
  content TEXT NOT NULL DEFAULT '',
  word_count INTEGER DEFAULT 0,
  self_note TEXT,
  status TEXT DEFAULT 'draft',
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sub_module ON submissions(module_id);

CREATE TABLE IF NOT EXISTS analyses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id INTEGER NOT NULL,
  module_id TEXT,
  score REAL DEFAULT 0,
  verdict TEXT,
  dimensions TEXT DEFAULT '[]',
  strengths TEXT DEFAULT '[]',
  weaknesses TEXT DEFAULT '[]',
  suggestions TEXT DEFAULT '[]',
  rewrite TEXT,
  source TEXT DEFAULT 'local',
  raw TEXT,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_ana_sub ON analyses(submission_id);

CREATE TABLE IF NOT EXISTS works (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT DEFAULT '',
  genre TEXT DEFAULT '',
  liyi TEXT DEFAULT '',
  zhuti TEXT DEFAULT '',
  genggai TEXT DEFAULT '',
  shijieguan TEXT DEFAULT '',
  renwu TEXT DEFAULT '',
  juqing TEXT DEFAULT '',
  fenjuan TEXT DEFAULT '',
  wenti TEXT DEFAULT '',
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  module_id TEXT,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_chat_module ON chat_messages(module_id);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS lesson_progress (
  module_id TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  done INTEGER DEFAULT 0,
  updated_at TEXT,
  PRIMARY KEY (module_id, lesson_id)
);

CREATE TABLE IF NOT EXISTS daily_logs (
  day TEXT PRIMARY KEY,
  words INTEGER DEFAULT 0,
  submissions INTEGER DEFAULT 0,
  analyses INTEGER DEFAULT 0
);
`;

@Injectable()
export class DatabaseService implements OnModuleInit {
  private db: Database.Database;

  onModuleInit() {
    this.open();
  }

  open() {
    if (this.db) return this.db;
    const dbPath =
      process.env.DB_PATH || path.join(process.cwd(), 'data', 'studio.db');
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.exec(SCHEMA);
    return this.db;
  }

  get instance(): Database.Database {
    return this.open();
  }

  all<T = any>(sql: string, params: any[] = []): T[] {
    return this.instance.prepare(sql).all(...params) as T[];
  }

  get<T = any>(sql: string, params: any[] = []): T {
    return this.instance.prepare(sql).get(...params) as T;
  }

  run(sql: string, params: any[] = []) {
    return this.instance.prepare(sql).run(...params);
  }

  exec(sql: string) {
    return this.instance.exec(sql);
  }

  transaction<T>(fn: () => T): T {
    return this.instance.transaction(fn)();
  }
}
