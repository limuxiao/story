import sqlite3
import time
from . import config


def _conn():
    conn = sqlite3.connect(config.DB_PATH)
    conn.execute(
        """CREATE TABLE IF NOT EXISTS sources(
            id TEXT PRIMARY KEY,
            name TEXT,
            width INTEGER,
            height INTEGER,
            duration REAL,
            preview_url TEXT,
            original_url TEXT,
            created_at REAL
        )"""
    )
    return conn


def insert_source(s: dict):
    conn = _conn()
    conn.execute(
        "INSERT OR REPLACE INTO sources VALUES (?,?,?,?,?,?,?,?)",
        (
            s["id"],
            s.get("name", ""),
            int(s.get("width", 0) or 0),
            int(s.get("height", 0) or 0),
            float(s.get("duration", 0) or 0),
            s.get("preview_url", ""),
            s.get("original_url", ""),
            time.time(),
        ),
    )
    conn.commit()
    conn.close()


def list_sources():
    conn = _conn()
    cur = conn.execute(
        "SELECT id,name,width,height,duration,preview_url,original_url FROM sources ORDER BY created_at DESC"
    )
    cols = [d[0] for d in cur.description]
    rows = [dict(zip(cols, r)) for r in cur.fetchall()]
    conn.close()
    return rows
