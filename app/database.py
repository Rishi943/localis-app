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
# DB_NAME is the canonical path (can be overridden by main.py)
# DB_NAME and DB_PATH must stay in sync for backward compatibility
DB_NAME = DB_PATH

def _ensure_db_directory():
    """Ensures the parent directory of the database exists."""
    # Use DB_NAME as canonical path (main.py may override it)
    db_dir = os.path.dirname(DB_NAME)
    if db_dir and not os.path.exists(db_dir):
        os.makedirs(db_dir, exist_ok=True)

def _connect_db() -> sqlite3.Connection:
    """Creates a database connection, ensuring the directory exists first."""
    _ensure_db_directory()
    # Use DB_NAME as canonical path (supports main.py override)
    return sqlite3.connect(DB_NAME)

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

    # 7. RAG Files (Phase 0A + Phase 1A)
    c.execute("""
        CREATE TABLE IF NOT EXISTS rag_files (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            original_name TEXT NOT NULL,
            stored_path TEXT NOT NULL,
            mime TEXT,
            size_bytes INTEGER,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL,
            extracted_path TEXT,
            chunks_path TEXT,
            page_count INTEGER,
            char_count INTEGER,
            chunk_count INTEGER,
            error TEXT,
            updated_at TEXT
        )
    """)

    # Safe migration: Add new columns if they don't exist (Phase 1A)
    c.execute("PRAGMA table_info(rag_files)")
    existing_columns = {row[1] for row in c.fetchall()}

    new_columns = {
        'extracted_path': 'TEXT',
        'chunks_path': 'TEXT',
        'page_count': 'INTEGER',
        'char_count': 'INTEGER',
        'chunk_count': 'INTEGER',
        'error': 'TEXT',
        'updated_at': 'TEXT',
        'vector_count': 'INTEGER',
        'indexed_at': 'TEXT',
        'index_backend': 'TEXT',
        'index_collection': 'TEXT',
        'is_active': 'INTEGER',
        'content_sha256': 'TEXT'
    }

    for col_name, col_type in new_columns.items():
        if col_name not in existing_columns:
            c.execute(f"ALTER TABLE rag_files ADD COLUMN {col_name} {col_type}")
            print(f" [Database] Added column '{col_name}' to rag_files table")



    # Create UNIQUE INDEX on (session_id, content_sha256) for deduplication
    c.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_rag_session_sha256
        ON rag_files(session_id, content_sha256)
        WHERE content_sha256 IS NOT NULL
    """)

    # Create RAG session settings table
    c.execute("""
        CREATE TABLE IF NOT EXISTS rag_session_settings (
            session_id TEXT PRIMARY KEY,
            rag_enabled INTEGER NOT NULL DEFAULT 1,
            auto_index INTEGER NOT NULL DEFAULT 1,
            updated_at TEXT
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


def get_chat_history(session_id: str, limit: Optional[int] = None) -> List[Dict[str, Any]]:
    """Get chat history, optionally limited to N most recent messages"""
    conn = _connect_db()
    conn.row_factory = sqlite3.Row
    c = conn.cursor()

    if limit:
        # Get N most recent messages (reversed to maintain chronological order)
        c.execute("""
            SELECT * FROM (
                SELECT role, content, timestamp, tokens
                FROM messages
                WHERE session_id = ?
                ORDER BY timestamp DESC
                LIMIT ?
            )
            ORDER BY timestamp ASC
        """, (session_id, limit))
    else:
        # Get all messages
        c.execute("""
            SELECT role, content, timestamp, tokens
            FROM messages
            WHERE session_id = ?
            ORDER BY timestamp ASC
        """, (session_id,))

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


def update_session_title(session_id: str, title: str) -> None:
    """Update the title of a session."""
    conn = _connect_db()
    c = conn.cursor()
    c.execute("UPDATE sessions SET title = ? WHERE id = ?", (title, session_id))
    conn.commit()
    conn.close()


def get_session_title(session_id: str) -> Optional[str]:
    """Get the title of a session."""
    conn = _connect_db()
    c = conn.cursor()
    c.execute("SELECT title FROM sessions WHERE id = ?", (session_id,))
    row = c.fetchone()
    conn.close()
    return row[0] if row else None


def delete_session(session_id: str) -> bool:
    """Delete session, its messages, and its RAG file records."""
    conn = _connect_db()
    c = conn.cursor()
    c.execute("DELETE FROM messages WHERE session_id = ?", (session_id,))
    c.execute("DELETE FROM rag_files WHERE session_id = ?", (session_id,))
    c.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
    deleted = c.rowcount > 0
    conn.commit()
    conn.close()
    return deleted


# ------------------------------
# RAG Files Operations (Phase 0A)
# ------------------------------

def rag_add_file(file_dict: Dict[str, Any]) -> None:
    """
    Adds a RAG file record to the database.
    Expects a dict with keys: id, session_id, original_name, stored_path, mime, size_bytes, status, created_at
    """
    conn = _connect_db()
    c = conn.cursor()
    c.execute("""
        INSERT INTO rag_files (id, session_id, original_name, stored_path, mime, size_bytes, status, created_at, content_sha256)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        file_dict["id"],
        file_dict["session_id"],
        file_dict["original_name"],
        file_dict["stored_path"],
        file_dict.get("mime"),
        file_dict.get("size_bytes"),
        file_dict["status"],
        file_dict["created_at"],
        file_dict.get("content_sha256")
    ))
    conn.commit()
    conn.close()


def rag_list_files(session_id: str) -> List[Dict[str, Any]]:
    """
    Lists all RAG files for a given session, ordered by created_at ASC.
    Includes extraction metadata (Phase 1A+).
    """
    conn = _connect_db()
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute("""
        SELECT id, session_id, original_name, stored_path, mime, size_bytes, status, created_at,
               extracted_path, chunks_path, page_count, char_count, chunk_count, error, updated_at,
               vector_count, indexed_at, index_backend, index_collection, is_active, content_sha256
        FROM rag_files
        WHERE session_id = ?
        ORDER BY created_at ASC
    """, (session_id,))
    rows = c.fetchall()
    conn.close()
    return [dict(row) for row in rows]


def rag_get_file(file_id: str) -> Optional[Dict[str, Any]]:
    """
    Retrieves a single RAG file record by ID.
    Includes extraction metadata (Phase 1A+).
    """
    conn = _connect_db()
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute("""
        SELECT id, session_id, original_name, stored_path, mime, size_bytes, status, created_at,
               extracted_path, chunks_path, page_count, char_count, chunk_count, error, updated_at
        FROM rag_files
        WHERE id = ?
    """, (file_id,))
    row = c.fetchone()
    conn.close()
    return dict(row) if row else None



def rag_find_file_by_sha256(session_id: str, sha256: str) -> Optional[Dict[str, Any]]:
    """
    Find a file by content SHA-256 within a session.
    Used for deduplication. Returns None if not found.
    """
    conn = _connect_db()
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute("""
        SELECT id, session_id, original_name, stored_path, mime, size_bytes, status, created_at,
               extracted_path, chunks_path, page_count, char_count, chunk_count, error, updated_at,
               vector_count, indexed_at, index_backend, index_collection, is_active, content_sha256, content_sha256
        FROM rag_files
        WHERE session_id = ? AND content_sha256 = ?
    """, (session_id, sha256))
    row = c.fetchone()
    conn.close()
    return dict(row) if row else None

def rag_delete_file(file_id: str) -> bool:
    """
    Deletes a RAG file record from the database by ID.
    Returns True if a row was deleted, False otherwise.
    """
    conn = _connect_db()
    c = conn.cursor()
    c.execute("DELETE FROM rag_files WHERE id = ?", (file_id,))
    rows = c.rowcount
    conn.commit()
    conn.close()
    return rows > 0


def rag_update_status(file_id: str, status: str) -> bool:
    """
    Updates the status of a RAG file.
    Returns True if a row was updated, False otherwise.
    """
    now = datetime.utcnow().isoformat()
    conn = _connect_db()
    c = conn.cursor()
    c.execute("""
        UPDATE rag_files
        SET status = ?, updated_at = ?
        WHERE id = ?
    """, (status, now, file_id))
    rows = c.rowcount
    conn.commit()
    conn.close()
    return rows > 0


def rag_update_extraction(
    file_id: str,
    extracted_path: str,
    page_count: int,
    char_count: int,
    status: str = "extracted"
) -> bool:
    """
    Updates RAG file with extraction metadata.
    Clears any previous error.
    Returns True if a row was updated, False otherwise.
    """
    now = datetime.utcnow().isoformat()
    conn = _connect_db()
    c = conn.cursor()
    c.execute("""
        UPDATE rag_files
        SET extracted_path = ?,
            page_count = ?,
            char_count = ?,
            status = ?,
            error = NULL,
            updated_at = ?
        WHERE id = ?
    """, (extracted_path, page_count, char_count, status, now, file_id))
    rows = c.rowcount
    conn.commit()
    conn.close()
    return rows > 0


def rag_set_error(file_id: str, error_message: str, status: str = "error") -> bool:
    """
    Sets error message and status for a RAG file.
    Returns True if a row was updated, False otherwise.
    """
    now = datetime.utcnow().isoformat()
    conn = _connect_db()
    c = conn.cursor()
    c.execute("""
        UPDATE rag_files
        SET error = ?,
            status = ?,
            updated_at = ?
        WHERE id = ?
    """, (error_message, status, now, file_id))
    rows = c.rowcount
    conn.commit()
    conn.close()
    return rows > 0


def rag_update_chunking(
    file_id: str,
    chunks_path: str,
    chunk_count: int,
    page_count: int = None,
    char_count: int = None,
    status: str = "chunked"
) -> bool:
    """
    Updates RAG file with chunking metadata.
    Clears any previous error.
    Returns True if a row was updated, False otherwise.
    """
    now = datetime.utcnow().isoformat()
    conn = _connect_db()
    c = conn.cursor()
    c.execute("""
        UPDATE rag_files
        SET chunks_path = ?,
            chunk_count = ?,
            page_count = COALESCE(?, page_count),
            char_count = COALESCE(?, char_count),
            status = ?,
            error = NULL,
            updated_at = ?
        WHERE id = ?
    """, (chunks_path, chunk_count, page_count, char_count, status, now, file_id))
    rows = c.rowcount
    conn.commit()
    conn.close()
    return rows > 0


def rag_update_indexing(
    file_id: str,
    vector_count: int,
    index_backend: str,
    index_collection: str,
    status: str = "indexed"
) -> bool:
    """
    Updates RAG file with vector indexing metadata.
    Clears any previous error.
    Returns True if a row was updated, False otherwise.
    """
    now = datetime.utcnow().isoformat()
    conn = _connect_db()
    c = conn.cursor()
    c.execute("""
        UPDATE rag_files
        SET vector_count = ?,
            index_backend = ?,
            index_collection = ?,
            status = ?,
            error = NULL,
            indexed_at = ?
        WHERE id = ?
    """, (vector_count, index_backend, index_collection, status, now, file_id))
    rows = c.rowcount
    conn.commit()
    conn.close()
    return rows > 0


def rag_get_session_settings(session_id: str) -> Dict[str, bool]:
    """Get or create RAG session settings."""
    conn = _connect_db()
    c = conn.cursor()
    c.execute("SELECT rag_enabled, auto_index FROM rag_session_settings WHERE session_id = ?",
              (session_id,))
    row = c.fetchone()

    if not row:
        # Auto-create with defaults
        now = datetime.utcnow().isoformat()
        c.execute("INSERT INTO rag_session_settings (session_id, rag_enabled, auto_index, updated_at) VALUES (?, 1, 1, ?)",
                  (session_id, now))
        conn.commit()
        result = {"rag_enabled": True, "auto_index": True}
    else:
        result = {"rag_enabled": bool(row[0]), "auto_index": bool(row[1])}

    conn.close()
    return result


def rag_set_session_settings(session_id: str, rag_enabled: Optional[bool] = None, auto_index: Optional[bool] = None) -> Dict[str, bool]:
    """Update RAG session settings."""
    conn = _connect_db()
    c = conn.cursor()

    # Get current values
    c.execute("SELECT rag_enabled, auto_index FROM rag_session_settings WHERE session_id = ?", (session_id,))
    row = c.fetchone()

    if not row:
        # Create row if missing
        now = datetime.utcnow().isoformat()
        c.execute("INSERT INTO rag_session_settings (session_id, rag_enabled, auto_index, updated_at) VALUES (?, 1, 1, ?)",
                  (session_id, now))
        current = {"rag_enabled": True, "auto_index": True}
    else:
        current = {"rag_enabled": bool(row[0]), "auto_index": bool(row[1])}

    # Update changed values
    new_rag_enabled = rag_enabled if rag_enabled is not None else current["rag_enabled"]
    new_auto_index = auto_index if auto_index is not None else current["auto_index"]

    now = datetime.utcnow().isoformat()
    c.execute("UPDATE rag_session_settings SET rag_enabled = ?, auto_index = ?, updated_at = ? WHERE session_id = ?",
              (int(new_rag_enabled), int(new_auto_index), now, session_id))
    conn.commit()
    conn.close()

    return {"rag_enabled": new_rag_enabled, "auto_index": new_auto_index}


def rag_set_file_active(session_id: str, file_id: str, is_active: bool) -> bool:
    """Set file active status (validates session ownership)."""
    # Verify file belongs to session
    file_record = rag_get_file(file_id)
    if not file_record or file_record["session_id"] != session_id:
        return False

    conn = _connect_db()
    c = conn.cursor()
    now = datetime.utcnow().isoformat()
    c.execute("UPDATE rag_files SET is_active = ?, updated_at = ? WHERE id = ?",
              (int(is_active), now, file_id))
    rows = c.rowcount
    conn.commit()
    conn.close()
    return rows > 0
