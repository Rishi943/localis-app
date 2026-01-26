# app/database.py
import json
import re
import sqlite3
import os
import time
from datetime import datetime
from typing import List, Dict, Any, Optional, Tuple, Union

# ------------------------------
# Database Path Resolution
# ------------------------------

def _resolve_db_path() -> str:
    """
    Resolves the database path based on environment variables.
    Priority:
    1. LOCALIS_DB_PATH - exact path if set
    2. LOCALIS_DATA_DIR - <dir>/chat_history.db if set
    3. Fallback - chat_history.db in current directory
    """
    if "LOCALIS_DB_PATH" in os.environ:
        return os.environ["LOCALIS_DB_PATH"]
    elif "LOCALIS_DATA_DIR" in os.environ:
        data_dir = os.environ["LOCALIS_DATA_DIR"]
        return os.path.join(data_dir, "chat_history.db")
    else:
        return "chat_history.db"

DB_PATH = _resolve_db_path()

def _ensure_db_directory():
    """Ensures the parent directory of the database exists."""
    db_dir = os.path.dirname(DB_PATH)
    if db_dir and not os.path.exists(db_dir):
        os.makedirs(db_dir, exist_ok=True)

def _connect_db() -> sqlite3.Connection:
    """Creates a database connection, ensuring the directory exists first."""
    _ensure_db_directory()
    return sqlite3.connect(DB_PATH)

# ------------------------------
# Strict Auto-Memory Schema
# ------------------------------

ALLOWED_AUTO_MEMORY_KEYS = {
    # Identity & locale
    "preferred_name",
    "location",
    "timezone",
    "language_preferences",

    # Work & schedule
    "occupation",
    "employer",
    "work_schedule",

    # Long-term profile buckets
    "interests",
    "projects",
    "goals",
    "habits_routines",
    "media_preferences",
    "values",
    "traits",

    # Interaction preferences
    "assistant_interaction_preferences",

    # Safety valve
    "misc",
}

# Tier-A Keys (Core Profile)
TIER_A_KEYS = {
    "preferred_name",
    "location",
    "timezone",
    "language_preferences",
}

_CANONICAL_ALIAS_MAP = {
    "name": "preferred_name",
    "my_name": "preferred_name",
    "user_name": "preferred_name",
    "city": "location",
    "current_city": "location",
    "time_zone": "timezone",
    "job": "occupation",
    "role": "occupation",
    "company": "employer",
}

# ------------------------------
# Core DB Functions
# ------------------------------

def init_db():
    """
    Initializes the SQLite database with the required tables.
    Performs a schema health check to handle legacy databases.
    """
    # Detect fresh install before connection creates the file
    is_new_db = not os.path.exists(DB_PATH)

    # 0. Schema Health Check
    if os.path.exists(DB_PATH):
        try:
            conn = _connect_db()
            c = conn.cursor()

            # Check sessions table columns
            c.execute("PRAGMA table_info(sessions)")
            sessions_columns = {row[1] for row in c.fetchall()}

            # Check messages table columns
            c.execute("PRAGMA table_info(messages)")
            messages_columns = {row[1] for row in c.fetchall()}

            conn.close()

            # Definition of a "broken" legacy schema for our purposes
            # 1. sessions table exists BUT is missing 'id'
            # 2. messages table exists BUT is missing 'timestamp'

            is_legacy_sessions = (len(sessions_columns) > 0 and "id" not in sessions_columns)
            is_legacy_messages = (len(messages_columns) > 0 and "timestamp" not in messages_columns)

            if is_legacy_sessions or is_legacy_messages:
                print(" [System] Critical: Database schema mismatch detected (legacy version).")
                timestamp = int(time.time())
                backup_name = f"{DB_PATH}.bak.{timestamp}"
                try:
                    os.rename(DB_PATH, backup_name)
                    print(f" [System] Data Preservation: Renamed old DB to '{backup_name}'.")
                    print(" [System] Creating fresh database with correct schema...")
                    # If we renamed the DB, the new one will be fresh
                    is_new_db = True
                except OSError as e:
                    print(f" [System] Error renaming database: {e}")

        except Exception as e:
            print(f" [System] Warning: Database health check failed ({e}). Proceeding...")

    conn = _connect_db()
    c = conn.cursor()

    # 1. Sessions & Messages
    c.execute("CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, title TEXT, created_at TEXT)")
    c.execute("""
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT, role TEXT, content TEXT, tokens INTEGER, timestamp TEXT,
            FOREIGN KEY(session_id) REFERENCES sessions(id)
        )
    """)

    # 2. User Memory (Value Store)
    c.execute("""
        CREATE TABLE IF NOT EXISTS user_memory (
            key TEXT PRIMARY KEY, value TEXT, category TEXT, last_updated TEXT
        )
    """)

    # 3. User Memory Metadata
    c.execute("""
        CREATE TABLE IF NOT EXISTS user_memory_meta (
            key TEXT PRIMARY KEY, meta_json TEXT NOT NULL, created_at TEXT, last_updated TEXT
        )
    """)

    # 4. Vector Memory
    c.execute("""
        CREATE TABLE IF NOT EXISTS vector_memory (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            content TEXT NOT NULL, embedding BLOB NOT NULL, meta_json TEXT NOT NULL,
            created_at TEXT, last_updated TEXT
        )
    """)

    # 5. Memory Events (Phase 6)
    c.execute("""
        CREATE TABLE IF NOT EXISTS memory_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts TEXT NOT NULL, session_id TEXT, event TEXT NOT NULL, payload_json TEXT NOT NULL
        )
    """)

    # 6. App Settings (Persistence)
    c.execute("""
        CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY, value TEXT, last_updated TEXT
        )
    """)

    # Seed tutorial flag ONLY if this is a fresh install (or recreated after backup)
    if is_new_db:
        now = datetime.utcnow().isoformat()
        c.execute("INSERT OR IGNORE INTO app_settings (key, value, last_updated) VALUES (?, ?, ?)",
                  ("tutorial_completed", "false", now))

    conn.commit()
    conn.close()

def _safe_key(raw_key: str) -> Optional[str]:
    if not raw_key: return None
    k = raw_key.strip().lower().replace(" ", "_")
    k = re.sub(r"[^a-z0-9_]", "", k)
    return _CANONICAL_ALIAS_MAP.get(k, k)

# ------------------------------
# Memory Operations (Values)
# ------------------------------

def upsert_user_memory(key: str, value: str, category: str = "auto") -> None:
    k = _safe_key(key)
    if not k: return

    # Strict Validation for Identity (Tier-A) to prevent 'misc' pollution
    if category == "identity":
        if k not in TIER_A_KEYS: return
    else:
        if k not in ALLOWED_AUTO_MEMORY_KEYS: k = "misc"

    now = datetime.utcnow().isoformat()
    conn = _connect_db()
    c = conn.cursor()
    c.execute("""
        INSERT INTO user_memory (key, value, category, last_updated)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
            value=excluded.value, category=excluded.category, last_updated=excluded.last_updated
    """, (k, value, category, now))
    conn.commit()
    conn.close()

def delete_user_memory(key: str) -> bool:
    k = _safe_key(key)
    if not k: return False
    conn = _connect_db()
    c = conn.cursor()
    c.execute("DELETE FROM user_memory WHERE key = ?", (k,))
    rows = c.rowcount
    conn.commit()
    conn.close()
    return rows > 0

def get_user_memory_value(key: str) -> Optional[str]:
    k = _safe_key(key)
    if not k: return None
    conn = _connect_db()
    c = conn.cursor()
    c.execute("SELECT value FROM user_memory WHERE key = ?", (k,))
    row = c.fetchone()
    conn.close()
    return row[0] if row else None

# ------------------------------
# Memory Operations (Metadata)
# ------------------------------

def upsert_user_memory_meta(key: str, meta: Dict[str, Any]) -> None:
    safe_key = _safe_key(key)
    if not safe_key: return

    meta_json = json.dumps(meta, sort_keys=True, separators=(",", ":"))
    now = datetime.utcnow().isoformat()
    conn = _connect_db()
    c = conn.cursor()
    c.execute("SELECT created_at FROM user_memory_meta WHERE key = ?", (safe_key,))
    row = c.fetchone()

    if row:
        c.execute("UPDATE user_memory_meta SET meta_json = ?, last_updated = ? WHERE key = ?", (meta_json, now, safe_key))
    else:
        c.execute("INSERT INTO user_memory_meta (key, meta_json, created_at, last_updated) VALUES (?, ?, ?, ?)", (safe_key, meta_json, now, now))
    conn.commit()
    conn.close()

def delete_user_memory_meta(key: str) -> bool:
    k = _safe_key(key)
    if not k: return False
    conn = _connect_db()
    c = conn.cursor()
    c.execute("DELETE FROM user_memory_meta WHERE key = ?", (k,))
    rows = c.rowcount
    conn.commit()
    conn.close()
    return rows > 0

def merge_user_memory_meta(key: str, updates: Dict[str, Any]) -> Dict[str, Any]:
    existing_meta = get_user_memory_meta(key) or {}
    return {**existing_meta, **updates}

def get_user_memory_meta(key: str) -> Optional[Dict[str, Any]]:
    safe_key = _safe_key(key)
    conn = _connect_db()
    c = conn.cursor()
    c.execute("SELECT meta_json FROM user_memory_meta WHERE key = ?", (safe_key,))
    row = c.fetchone()
    conn.close()
    if row and row[0]:
        try: return json.loads(row[0])
        except: return None
    return None

def get_core_user_memories_with_meta() -> List[Dict[str, Any]]:
    conn = _connect_db()
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    placeholders = ",".join("?" for _ in TIER_A_KEYS)
    sql = f"""
        SELECT m.key, m.value, m.category, meta.meta_json, meta.created_at AS meta_created_at
        FROM user_memory m
        LEFT JOIN user_memory_meta meta ON m.key = meta.key
        WHERE m.key IN ({placeholders})
        ORDER BY m.category, m.key
    """
    c.execute(sql, list(TIER_A_KEYS))
    rows = c.fetchall()
    conn.close()

    results = []
    for row in rows:
        item = dict(row)
        item["meta"] = json.loads(item["meta_json"]) if item["meta_json"] else None
        del item["meta_json"]
        results.append(item)
    return results

def get_extended_user_memories_with_meta() -> List[Dict[str, Any]]:
    """
    Retrieves all user memories that are NOT in the Tier-A (Identity) set.
    Used for tool-based retrieval and general knowledge.
    """
    conn = _connect_db()
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    placeholders = ",".join("?" for _ in TIER_A_KEYS)
    sql = f"""
        SELECT m.key, m.value, m.category, meta.meta_json, meta.created_at AS meta_created_at
        FROM user_memory m
        LEFT JOIN user_memory_meta meta ON m.key = meta.key
        WHERE m.key NOT IN ({placeholders})
        ORDER BY m.category, m.key
    """
    c.execute(sql, list(TIER_A_KEYS))
    rows = c.fetchall()
    conn.close()

    results = []
    for row in rows:
        item = dict(row)
        item["meta"] = json.loads(item["meta_json"]) if item["meta_json"] else None
        del item["meta_json"]
        results.append(item)
    return results

# ------------------------------
# Vector Memory Operations
# ------------------------------

def add_vector_memory_item(content: str, embedding: bytes, meta: Dict[str, Any]) -> int:
    meta_json = json.dumps(meta, sort_keys=True, separators=(",", ":"))
    now = datetime.utcnow().isoformat()
    conn = _connect_db()
    c = conn.cursor()
    c.execute("""
        INSERT INTO vector_memory (content, embedding, meta_json, created_at, last_updated)
        VALUES (?, ?, ?, ?, ?)
    """, (content, embedding, meta_json, now, now))
    row_id = c.lastrowid
    conn.commit()
    conn.close()
    return row_id

def list_vector_memory_items(limit: int = 5000) -> List[Dict[str, Any]]:
    conn = _connect_db()
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute("""
        SELECT id, content, embedding, meta_json, created_at, last_updated
        FROM vector_memory ORDER BY id DESC LIMIT ?
    """, (limit,))
    rows = c.fetchall()
    conn.close()
    results = []
    for row in rows:
        item = dict(row)
        item["meta"] = json.loads(item["meta_json"]) if item["meta_json"] else {}
        del item["meta_json"]
        results.append(item)
    return results

def delete_vector_memory_item(item_id: int) -> bool:
    conn = _connect_db()
    c = conn.cursor()
    c.execute("DELETE FROM vector_memory WHERE id = ?", (item_id,))
    rows = c.rowcount
    conn.commit()
    conn.close()
    return rows > 0

# ------------------------------
# Memory Events (Phase 6)
# ------------------------------

def add_memory_event(event: str, payload: Dict[str, Any], session_id: Optional[str] = None) -> None:
    ts = datetime.utcnow().isoformat()
    try: payload_json = json.dumps(payload, sort_keys=True)
    except: payload_json = "{}"
    conn = _connect_db()
    c = conn.cursor()
    c.execute("INSERT INTO memory_events (ts, session_id, event, payload_json) VALUES (?, ?, ?, ?)", (ts, session_id, event, payload_json))
    conn.commit()
    conn.close()

def get_memory_events(session_id: Optional[str] = None) -> List[Dict[str, Any]]:
    conn = _connect_db()
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    sql = "SELECT id, ts, session_id, event, payload_json FROM memory_events "
    params = []
    if session_id:
        sql += "WHERE session_id = ? "
        params.append(session_id)
    sql += "ORDER BY id DESC LIMIT 200"
    c.execute(sql, params)
    rows = c.fetchall()
    conn.close()
    results = []
    for row in rows:
        item = dict(row)
        item["payload"] = json.loads(item["payload_json"]) if item["payload_json"] else {}
        del item["payload_json"]
        results.append(item)
    return results

# ------------------------------
# App Settings (Persistence)
# ------------------------------

def get_app_setting(key: str) -> Optional[str]:
    """Retrieves a single setting value by key."""
    conn = _connect_db()
    c = conn.cursor()
    c.execute("SELECT value FROM app_settings WHERE key = ?", (key,))
    row = c.fetchone()
    conn.close()
    return row[0] if row else None


def set_app_setting(key: str, value: str) -> None:
    """Upserts a setting value."""
    now = datetime.utcnow().isoformat()
    conn = _connect_db()
    c = conn.cursor()
    c.execute("""
        INSERT INTO app_settings (key, value, last_updated)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
            value=excluded.value, last_updated=excluded.last_updated
    """, (key, value, now))
    conn.commit()
    conn.close()


def delete_app_setting(key: str) -> bool:
    """Deletes a setting key."""
    conn = _connect_db()
    c = conn.cursor()
    c.execute("DELETE FROM app_settings WHERE key = ?", (key,))
    rows = c.rowcount
    conn.commit()
    conn.close()
    return rows > 0


def get_all_app_settings() -> Dict[str, str]:
    """Retrieves all settings as a dictionary."""
    conn = _connect_db()
    c = conn.cursor()
    c.execute("SELECT key, value FROM app_settings")
    rows = c.fetchall()
    conn.close()
    return {row[0]: row[1] for row in rows}

# ------------------------------
# Session & History Functions
# ------------------------------

def get_recent_sessions(limit: int = 20) -> List[Dict[str, Any]]:
    conn = _connect_db()
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute("SELECT id, title, created_at FROM sessions ORDER BY created_at DESC LIMIT ?", (limit,))
    rows = c.fetchall()
    conn.close()
    return [dict(row) for row in rows]


def get_chat_history(session_id: str, limit: int = 200) -> List[Dict[str, Any]]:
    conn = _connect_db()
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute("""
        SELECT role, content, timestamp, tokens
        FROM messages
        WHERE session_id = ?
        ORDER BY timestamp ASC
        LIMIT ?
    """, (session_id, limit))
    rows = c.fetchall()
    conn.close()
    return [dict(row) for row in rows]


def add_message(session_id: str, role: str, content: str, tokens: int = 0) -> None:
    now = datetime.utcnow().isoformat()
    conn = _connect_db()
    c = conn.cursor()

    c.execute("INSERT OR IGNORE INTO sessions (id, title, created_at) VALUES (?, ?, ?)",
              (session_id, f"Session {session_id[:8]}", now))

    c.execute("INSERT INTO messages (session_id, role, content, tokens, timestamp) VALUES (?, ?, ?, ?, ?)",
              (session_id, role, content, tokens, now))

    conn.commit()
    conn.close()
