"""
app/notes.py
Notes and Reminders backend module.

Phase 02.1 — Notes and Reminders
Follows the register_*(app, ...) module pattern from finance.py.

Exports: register_notes, router
"""
import sqlite3
import uuid
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from . import database

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/notes", tags=["notes"])


# ---------------------------------------------------------------------------
# Module registration
# ---------------------------------------------------------------------------

def register_notes(app, db_path: str) -> None:
    """Register the notes router with the FastAPI app."""
    app.state.notes_db = str(db_path)
    app.include_router(router)
    logger.info("[Notes] Notes module registered")


def _db(request: Request) -> str:
    """Extract DB path from app.state (set by register_notes)."""
    return request.app.state.notes_db


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class AddNoteRequest(BaseModel):
    content: str
    note_type: str = "note"       # "note" | "reminder"
    due_at: Optional[str] = None  # ISO8601 UTC string, null for plain notes
    color: str = "default"        # color key: "default", "deep-blue", "dark-teal", "amber-night", "rose-night", "mauve-glass"


class UpdateNoteRequest(BaseModel):
    content: Optional[str] = None
    color: Optional[str] = None
    pinned: Optional[int] = None


# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------

VALID_COLORS = {"default", "deep-blue", "dark-teal", "amber-night", "rose-night", "mauve-glass"}
VALID_TYPES = {"note", "reminder"}

def _now_utc() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/add")
async def add_note(req: AddNoteRequest, request: Request):
    """Create a new note or reminder."""
    if req.note_type not in VALID_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid note_type: {req.note_type}")
    if req.color not in VALID_COLORS:
        raise HTTPException(status_code=400, detail=f"Invalid color: {req.color}")
    if req.note_type == "reminder" and not req.due_at:
        raise HTTPException(status_code=400, detail="due_at is required for reminders")

    note_id = str(uuid.uuid4())
    now = _now_utc()

    db_path = _db(request)
    conn = sqlite3.connect(db_path)
    try:
        c = conn.cursor()
        c.execute(
            """INSERT INTO notes (id, content, note_type, due_at, color, pinned, dismissed, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)""",
            (note_id, req.content, req.note_type, req.due_at, req.color, now, now)
        )
        conn.commit()
        return JSONResponse({
            "id": note_id,
            "content": req.content,
            "note_type": req.note_type,
            "due_at": req.due_at,
            "color": req.color,
            "pinned": 0,
            "dismissed": 0,
            "created_at": now,
            "updated_at": now
        }, status_code=201)
    finally:
        conn.close()


@router.get("/list")
async def list_notes(request: Request):
    """Return all non-dismissed notes ordered by pinned DESC, created_at DESC."""
    db_path = _db(request)
    conn = sqlite3.connect(db_path)
    try:
        c = conn.cursor()
        c.execute(
            """SELECT id, content, note_type, due_at, color, pinned, dismissed, created_at, updated_at
               FROM notes
               WHERE dismissed = 0
               ORDER BY pinned DESC, created_at DESC"""
        )
        rows = c.fetchall()
        cols = ["id", "content", "note_type", "due_at", "color", "pinned", "dismissed", "created_at", "updated_at"]
        notes = [dict(zip(cols, row)) for row in rows]
        return JSONResponse(notes)
    finally:
        conn.close()


@router.get("/due")
async def get_due_reminders(request: Request):
    """Return fired-but-undismissed reminders (due_at <= now, dismissed=0)."""
    db_path = _db(request)
    now = _now_utc()
    conn = sqlite3.connect(db_path)
    try:
        c = conn.cursor()
        c.execute(
            """SELECT id, content, note_type, due_at, color, pinned, dismissed, created_at, updated_at
               FROM notes
               WHERE note_type = 'reminder'
                 AND due_at <= ?
                 AND dismissed = 0""",
            (now,)
        )
        rows = c.fetchall()
        cols = ["id", "content", "note_type", "due_at", "color", "pinned", "dismissed", "created_at", "updated_at"]
        due = [dict(zip(cols, row)) for row in rows]
        return JSONResponse(due)
    finally:
        conn.close()


@router.patch("/{note_id}")
async def update_note(note_id: str, req: UpdateNoteRequest, request: Request):
    """Update note content, color, or pinned state."""
    db_path = _db(request)
    now = _now_utc()
    conn = sqlite3.connect(db_path)
    try:
        c = conn.cursor()
        # Build dynamic SET clause
        updates = []
        params = []
        if req.content is not None:
            updates.append("content = ?")
            params.append(req.content)
        if req.color is not None:
            if req.color not in VALID_COLORS:
                raise HTTPException(status_code=400, detail=f"Invalid color: {req.color}")
            updates.append("color = ?")
            params.append(req.color)
        if req.pinned is not None:
            updates.append("pinned = ?")
            params.append(req.pinned)
        if not updates:
            raise HTTPException(status_code=400, detail="No fields to update")

        updates.append("updated_at = ?")
        params.append(now)
        params.append(note_id)

        c.execute(f"UPDATE notes SET {', '.join(updates)} WHERE id = ?", params)
        if c.rowcount == 0:
            raise HTTPException(status_code=404, detail="Note not found")
        conn.commit()

        # Return updated note
        c.execute(
            "SELECT id, content, note_type, due_at, color, pinned, dismissed, created_at, updated_at FROM notes WHERE id = ?",
            (note_id,)
        )
        row = c.fetchone()
        cols = ["id", "content", "note_type", "due_at", "color", "pinned", "dismissed", "created_at", "updated_at"]
        return JSONResponse(dict(zip(cols, row)))
    finally:
        conn.close()


@router.delete("/{note_id}")
async def delete_note(note_id: str, request: Request):
    """Delete a note by ID (hard delete)."""
    db_path = _db(request)
    conn = sqlite3.connect(db_path)
    try:
        c = conn.cursor()
        c.execute("DELETE FROM notes WHERE id = ?", (note_id,))
        if c.rowcount == 0:
            raise HTTPException(status_code=404, detail="Note not found")
        conn.commit()
        return JSONResponse({"deleted": note_id})
    finally:
        conn.close()


@router.post("/dismiss/{note_id}")
async def dismiss_reminder(note_id: str, request: Request):
    """Mark a reminder as dismissed (sets dismissed=1). Used after reminder fires."""
    db_path = _db(request)
    now = _now_utc()
    conn = sqlite3.connect(db_path)
    try:
        c = conn.cursor()
        c.execute(
            "UPDATE notes SET dismissed = 1, updated_at = ? WHERE id = ? AND note_type = 'reminder'",
            (now, note_id)
        )
        if c.rowcount == 0:
            raise HTTPException(status_code=404, detail="Reminder not found or already dismissed")
        conn.commit()
        return JSONResponse({"dismissed": note_id})
    finally:
        conn.close()
