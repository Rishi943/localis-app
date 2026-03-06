# app/rag.py
from __future__ import annotations

import re
import hashlib
import mimetypes
import threading
import asyncio
import json
from pathlib import Path
from uuid import uuid4
from datetime import datetime, timezone
from typing import Optional, Dict, List

from fastapi import APIRouter, Request, HTTPException, UploadFile, File, Form
from fastapi.responses import StreamingResponse

from pydantic import BaseModel

from . import database
from . import rag_processing
from . import rag_vector

# ------------------------------
# Configuration
# ------------------------------

# Allowed file extensions (lowercase)
ALLOWED_EXTENSIONS = {".pdf", ".txt", ".md", ".docx", ".csv"}

# Max file size in bytes (100MB)
MAX_FILE_SIZE = 100 * 1024 * 1024

# Hard limits to prevent runaway workloads
MAX_FILES_PER_SESSION = 100  # Max files per session
MAX_TOTAL_BYTES_PER_SESSION = 500 * 1024 * 1024  # 500MB total per session
MAX_EXTRACTED_CHARS_PER_FILE = 1_000_000  # 1M chars extracted
MAX_CHUNKS_PER_FILE = 500  # Max chunks per file
MAX_TOP_K = 20  # Max search results per query

router = APIRouter(prefix="/rag", tags=["rag"])

# Job state management (Phase 4B - index jobs)
_jobs_lock = threading.Lock()
_jobs: Dict[str, Dict] = {}

# Ingest job state management (separate from index jobs)
_ingest_jobs_lock = threading.Lock()
_ingest_jobs: Dict[str, Dict] = {}


def _init_job_state(session_id: str) -> Dict:
    """Initialize job state for a session."""
    return {
        "state": "idle",  # idle|running|done|cancelled|error
        "total_files": 0,
        "done_files": 0,
        "current_file_id": None,
        "current_file_name": None,
        "message": "",
        "updated_at": datetime.utcnow().isoformat(),
        "cancel_requested": False,
    }


def _get_job_state(session_id: str) -> Dict:
    """Get job state for a session (creates if missing)."""
    with _jobs_lock:
        if session_id not in _jobs:
            _jobs[session_id] = _init_job_state(session_id)
        return dict(_jobs[session_id])  # Return a copy


def _update_job_state(session_id: str, **kwargs):
    """Update job state fields (thread-safe)."""
    with _jobs_lock:
        if session_id not in _jobs:
            _jobs[session_id] = _init_job_state(session_id)
        _jobs[session_id].update(kwargs)
        _jobs[session_id]["updated_at"] = datetime.utcnow().isoformat()


def _init_ingest_job_state(session_id: str) -> Dict:
    """Initialize ingest job state for a session."""
    return {
        "state": "idle",  # idle|running|done|cancelled|error
        "phase": "upload",  # upload|extract|chunk|index
        "total_files": 0,
        "done_files": 0,
        "current_file_id": None,
        "current_file_name": None,
        "message": "",
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "error": None,
        "cancel_requested": False,
    }


def _get_ingest_job_state(session_id: str) -> Dict:
    """Get ingest job state for a session (creates if missing)."""
    with _ingest_jobs_lock:
        if session_id not in _ingest_jobs:
            _ingest_jobs[session_id] = _init_ingest_job_state(session_id)
        return dict(_ingest_jobs[session_id])  # Return a copy


def _update_ingest_job_state(session_id: str, **kwargs):
    """Update ingest job state fields (thread-safe)."""
    with _ingest_jobs_lock:
        if session_id not in _ingest_jobs:
            _ingest_jobs[session_id] = _init_ingest_job_state(session_id)
        _ingest_jobs[session_id].update(kwargs)
        _ingest_jobs[session_id]["updated_at"] = datetime.now(timezone.utc).isoformat()


def _index_session_background(session_id: str, data_dir: Path, force: bool):
    """Background indexing task for a session (runs in thread)."""
    try:
        # Get all chunked files
        files = database.rag_list_files(session_id)
        chunked_files = [f for f in files if f["status"] == "chunked"]

        # Filter: only index non-indexed unless force
        if not force:
            chunked_files = [f for f in chunked_files if not f.get("indexed_at")]

        _update_job_state(
            session_id,
            state="running",
            total_files=len(chunked_files),
            done_files=0,
            message=f"Starting indexing of {len(chunked_files)} files...",
        )

        for i, file_record in enumerate(chunked_files):
            # Check cancellation
            current_state = _get_job_state(session_id)
            if current_state.get("cancel_requested"):
                _update_job_state(
                    session_id, state="cancelled", message="Indexing cancelled by user"
                )
                break

            file_id = file_record["id"]
            file_name = file_record["original_name"]

            # Update current file
            _update_job_state(
                session_id,
                current_file_id=file_id,
                current_file_name=file_name,
                message=f"Indexing file {i+1}/{len(chunked_files)}: {file_name}...",
            )

            # Mark as indexing
            database.rag_update_status(file_id, "indexing")

            try:
                # Index the file
                chunks_path = Path(file_record["chunks_path"])
                rag_vector.index_file(
                    session_id, file_id, chunks_path, data_dir, force=force
                )

                # Mark as indexed
                database.rag_update_status(file_id, "indexed")

                # Increment done count
                current_state = _get_job_state(session_id)
                _update_job_state(session_id, done_files=current_state["done_files"] + 1)

            except Exception as e:
                # Mark as error
                error_msg = str(e)[:200]
                database.rag_set_error(file_id, error_msg, status="error")
                _update_job_state(
                    session_id, message=f"Error indexing {file_name}: {error_msg}"
                )
                # Still increment done count
                current_state = _get_job_state(session_id)
                _update_job_state(session_id, done_files=current_state["done_files"] + 1)

        # Mark as done (if not cancelled)
        current_state = _get_job_state(session_id)
        if current_state["state"] != "cancelled":
            _update_job_state(
                session_id,
                state="done",
                message="Indexing complete",
                current_file_id=None,
                current_file_name=None,
            )

    except Exception as e:
        _update_job_state(session_id, state="error", message=str(e)[:200])


def _ingest_files_background(session_id: str, file_ids: List[str], data_dir: Path, force: bool):
    """
    Background ingest task: extract + chunk + index per file.
    Runs in a separate thread and updates ingest job state.
    """
    try:
        # Get file records
        files_to_process = []
        for file_id in file_ids:
            file_record = database.rag_get_file(file_id)
            if not file_record:
                continue
            if file_record["session_id"] != session_id:
                continue
            # Skip if already processed unless force
            if not force and file_record.get("status") in ["chunked", "indexed"]:
                continue
            files_to_process.append(file_record)

        total_files = len(files_to_process)
        _update_ingest_job_state(
            session_id,
            state="running",
            total_files=total_files,
            done_files=0,
            message=f"Starting ingest of {total_files} files...",
        )

        for i, file_record in enumerate(files_to_process):
            # Check cancellation
            current_state = _get_ingest_job_state(session_id)
            if current_state.get("cancel_requested"):
                _update_ingest_job_state(
                    session_id, state="cancelled", message="Ingest cancelled by user"
                )
                break

            file_id = file_record["id"]
            file_name = file_record["original_name"]
            stored_path = Path(file_record["stored_path"])
            safe_sess_id = _safe_session_id(session_id)
            derived_dir = data_dir / "rag" / "sessions" / safe_sess_id / "derived"

            # Phase 1: Extract
            try:
                _update_ingest_job_state(
                    session_id,
                    phase="extract",
                    current_file_id=file_id,
                    current_file_name=file_name,
                    message=f"Extracting {i+1}/{total_files}: {file_name}",
                )
                database.rag_update_status(file_id, "extracting")

                extraction_result = rag_processing.process_file_extraction(
                    file_id=file_id,
                    session_id=session_id,
                    original_name=file_name,
                    mime=file_record["mime"] or "",
                    stored_path=stored_path,
                    derived_dir=derived_dir
                )

                # Read extracted data
                import json as json_module
                extracted_path = Path(extraction_result["extracted_path"])
                with open(extracted_path, 'r') as f:
                    extracted_data = json_module.load(f)

                # Check extraction limits
                char_count = extracted_data.get("char_count", 0)
                if char_count > MAX_EXTRACTED_CHARS_PER_FILE:
                    error_msg = f"File too large: {char_count} chars exceeds limit"
                    database.rag_set_error(file_id, error_msg, status="error")
                    _update_ingest_job_state(
                        session_id,
                        message=f"Error on {file_name}: {error_msg}"
                    )
                    # Continue to next file
                    current_state = _get_ingest_job_state(session_id)
                    _update_ingest_job_state(session_id, done_files=current_state["done_files"] + 1)
                    continue

            except rag_processing.ExtractionError as e:
                error_msg = str(e)[:200]
                database.rag_set_error(file_id, error_msg, status="error")
                _update_ingest_job_state(
                    session_id,
                    message=f"Extraction error on {file_name}: {error_msg}"
                )
                # Continue to next file
                current_state = _get_ingest_job_state(session_id)
                _update_ingest_job_state(session_id, done_files=current_state["done_files"] + 1)
                continue

            # Phase 2: Chunk
            try:
                _update_ingest_job_state(
                    session_id,
                    phase="chunk",
                    message=f"Chunking {i+1}/{total_files}: {file_name}",
                )
                database.rag_update_status(file_id, "chunking")

                chunking_result = rag_processing.process_file_chunking(
                    file_id=file_id,
                    session_id=session_id,
                    original_name=file_name,
                    extraction_result=extracted_data,
                    derived_dir=derived_dir
                )

                # Check chunk limits
                chunk_count = chunking_result.get("chunk_count", 0)
                if chunk_count > MAX_CHUNKS_PER_FILE:
                    error_msg = f"Too many chunks: {chunk_count} exceeds limit"
                    database.rag_set_error(file_id, error_msg, status="error")
                    _update_ingest_job_state(
                        session_id,
                        message=f"Error on {file_name}: {error_msg}"
                    )
                    # Continue to next file
                    current_state = _get_ingest_job_state(session_id)
                    _update_ingest_job_state(session_id, done_files=current_state["done_files"] + 1)
                    continue

                # Update database with chunking metadata
                database.rag_update_chunking(
                    file_id=file_id,
                    chunks_path=chunking_result["chunks_path"],
                    chunk_count=chunking_result["chunk_count"],
                    page_count=extracted_data["page_count"],
                    char_count=extracted_data["char_count"],
                    status="chunked"
                )

            except rag_processing.ExtractionError as e:
                error_msg = str(e)[:200]
                database.rag_set_error(file_id, error_msg, status="error")
                _update_ingest_job_state(
                    session_id,
                    message=f"Chunking error on {file_name}: {error_msg}"
                )
                # Continue to next file
                current_state = _get_ingest_job_state(session_id)
                _update_ingest_job_state(session_id, done_files=current_state["done_files"] + 1)
                continue

            # Phase 3: Index
            try:
                _update_ingest_job_state(
                    session_id,
                    phase="index",
                    message=f"Indexing {i+1}/{total_files}: {file_name}",
                )
                database.rag_update_status(file_id, "indexing")

                chunks_path = Path(chunking_result["chunks_path"])
                rag_vector.index_file(
                    session_id, file_id, chunks_path, data_dir, force=force
                )

                # Mark as indexed
                database.rag_update_status(file_id, "indexed")

            except Exception as e:
                error_msg = str(e)[:200]
                database.rag_set_error(file_id, error_msg, status="error")
                _update_ingest_job_state(
                    session_id,
                    message=f"Indexing error on {file_name}: {error_msg}"
                )
                # Continue to next file
                current_state = _get_ingest_job_state(session_id)
                _update_ingest_job_state(session_id, done_files=current_state["done_files"] + 1)
                continue

            # File complete - increment done count
            current_state = _get_ingest_job_state(session_id)
            _update_ingest_job_state(session_id, done_files=current_state["done_files"] + 1)

        # Mark as done (if not cancelled)
        current_state = _get_ingest_job_state(session_id)
        if current_state["state"] != "cancelled":
            _update_ingest_job_state(
                session_id,
                state="done",
                phase="index",
                message="Ingest complete",
                current_file_id=None,
                current_file_name=None,
            )

    except Exception as e:
        _update_ingest_job_state(
            session_id,
            state="error",
            error=str(e)[:200],
            message=f"Ingest failed: {str(e)[:200]}"
        )


def register_rag(app, data_dir: Path) -> None:
    """
    Register RAG router and store data directory path on app state.
    """
    app.state.localis_data_dir = str(data_dir)
    app.include_router(router)


def _data_dir(request: Request) -> Path:
    """Get the Localis data directory from app state."""
    return Path(request.app.state.localis_data_dir)


def _safe_session_id(raw_session_id: str) -> str:
    """
    Sanitize session_id to prevent path traversal.
    Only allows [a-zA-Z0-9_-], replaces others with underscore.
    """
    if not raw_session_id:
        return "default"
    return re.sub(r"[^a-zA-Z0-9_-]", "_", raw_session_id)


def _validate_file_extension(filename: str) -> tuple[bool, Optional[str]]:
    """
    Validates file extension against whitelist.
    Returns (is_valid, extension_without_dot).
    """
    ext = Path(filename).suffix.lower()
    if ext in ALLOWED_EXTENSIONS:
        return True, ext[1:]  # Remove leading dot
    return False, None


# ------------------------------
# Routes
# ------------------------------

@router.post("/upload")
async def upload_file(
    request: Request,
    session_id: str = Form(...),
    file: UploadFile = File(...)
):
    """
    Upload a file for RAG in a specific session.

    - Validates extension whitelist
    - Enforces max file size (100MB)
    - Deduplicates by content SHA-256 within session
    - Stores file in DATA_DIR/rag/sessions/<session_id>/uploads/<file_id>.<ext>
    - Records metadata in database
    """
    data_dir = _data_dir(request)

    # 1. Validate Extension
    is_valid, ext = _validate_file_extension(file.filename or "")
    if not is_valid:
        raise HTTPException(status_code=400, detail="unsupported_file_type")

    # 2. Read File Content (with size check)
    content = await file.read()
    size_bytes = len(content)

    if size_bytes > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="file_too_large")

    # 2.5. Compute SHA-256 and check for duplicates
    content_sha256 = hashlib.sha256(content).hexdigest()
    existing = database.rag_find_file_by_sha256(session_id, content_sha256)
    if existing:
        # Return duplicate response with existing file info
        return {"status": "duplicate", "file": existing}

    # 2.75. Check session limits
    session_files = database.rag_list_files(session_id)
    if len(session_files) >= MAX_FILES_PER_SESSION:
        raise HTTPException(
            status_code=400,
            detail=f"Session limit reached: max {MAX_FILES_PER_SESSION} files per session"
        )
    
    total_bytes = sum(f.get("size_bytes", 0) for f in session_files)
    if total_bytes + size_bytes > MAX_TOTAL_BYTES_PER_SESSION:
        raise HTTPException(
            status_code=400,
            detail=f"Session storage limit exceeded: max {MAX_TOTAL_BYTES_PER_SESSION // (1024*1024)}MB per session"
        )

    # 3. Generate File ID and Paths
    file_id = uuid4().hex
    safe_sess_id = _safe_session_id(session_id)

    session_dir = data_dir / "rag" / "sessions" / safe_sess_id / "uploads"
    session_dir.mkdir(parents=True, exist_ok=True)

    stored_path = session_dir / f"{file_id}.{ext}"

    # 4. Write to Disk
    with stored_path.open("wb") as f:
        f.write(content)

    # 5. Determine MIME Type
    mime, _ = mimetypes.guess_type(file.filename or "")
    if not mime:
        mime = "application/octet-stream"

    # 6. Store Metadata in DB
    now = datetime.utcnow().isoformat()
    file_record = {
        "id": file_id,
        "session_id": session_id,  # Store original session_id
        "original_name": file.filename or f"file.{ext}",
        "stored_path": str(stored_path),
        "mime": mime,
        "size_bytes": size_bytes,
        "status": "uploaded",
        "created_at": now,
        "content_sha256": content_sha256,
    }

    database.rag_add_file(file_record)

    return {"ok": True, "file": file_record}


@router.get("/list")
async def list_files(session_id: str):
    """
    List all uploaded files for a session, ordered by created_at ASC.
    Includes session settings with files.
    """
    files = database.rag_list_files(session_id)
    settings = database.rag_get_session_settings(session_id)
    return {
        "ok": True,
        "files": files,
        "settings": {
            "rag_enabled": settings.get("rag_enabled", 1),
            "auto_index": settings.get("auto_index", 1)
        }
    }


@router.delete("/file/{file_id}")
async def delete_file(request: Request, file_id: str, session_id: str):
    """
    Delete a file by ID.
    Validates that the file belongs to the specified session_id.
    Deletes: original file, extracted/chunked files, derived directory, vectors, DB record.
    """
    import shutil

    data_dir = _data_dir(request)

    # 1. Get File Metadata
    file_record = database.rag_get_file(file_id)

    if not file_record:
        raise HTTPException(status_code=404, detail="file_not_found")

    # 2. Validate Session Ownership
    if file_record["session_id"] != session_id:
        raise HTTPException(status_code=403, detail="session_mismatch")

    # 3. Delete Original File on Disk (if exists)
    stored_path = Path(file_record["stored_path"])
    if stored_path.exists():
        stored_path.unlink()

    # 4. Delete Extracted/Chunked Files (if they exist)
    if file_record.get("extracted_path"):
        extracted_path = Path(file_record["extracted_path"])
        if extracted_path.exists():
            extracted_path.unlink()

    if file_record.get("chunks_path"):
        chunks_path = Path(file_record["chunks_path"])
        if chunks_path.exists():
            chunks_path.unlink()

    # 5. Delete Derived Directory (derived_dir / file_id)
    safe_sess_id = _safe_session_id(session_id)
    derived_dir = data_dir / "rag" / "sessions" / safe_sess_id / "derived"
    file_derived_dir = derived_dir / file_id
    if file_derived_dir.exists():
        try:
            shutil.rmtree(file_derived_dir)
        except Exception:
            pass  # Ignore errors, best-effort cleanup

    # 6. Delete Vectors (if indexed)
    rag_vector.delete_file_vectors(session_id, file_id, data_dir)

    # 7. Delete DB Record
    success = database.rag_delete_file(file_id)

    return {"ok": success}


@router.post("/process/{file_id}")
async def process_file(request: Request, file_id: str, session_id: str):
    """
    Process a file: extract text and create chunks.

    Phase 1B: Extraction + Chunking end-to-end.
    Statuses: uploaded -> extracting -> chunking -> chunked

    Args:
        file_id: File ID to process
        session_id: Session ID (must match file's session)

    Returns:
        JSON with processing status and metadata
    """
    data_dir = _data_dir(request)

    # 1. Get File Metadata
    file_record = database.rag_get_file(file_id)

    if not file_record:
        raise HTTPException(status_code=404, detail="file_not_found")

    # 2. Validate Session Ownership
    if file_record["session_id"] != session_id:
        raise HTTPException(status_code=403, detail="session_mismatch")

    # 3. Update Status to "extracting"
    database.rag_update_status(file_id, "extracting")

    try:
        # 4. Process Extraction
        stored_path = Path(file_record["stored_path"])
        safe_sess_id = _safe_session_id(session_id)
        derived_dir = data_dir / "rag" / "sessions" / safe_sess_id / "derived"

        extraction_result = rag_processing.process_file_extraction(
            file_id=file_id,
            session_id=session_id,
            original_name=file_record["original_name"],
            mime=file_record["mime"] or "",
            stored_path=stored_path,
            derived_dir=derived_dir
        )

        # 5. Update Status to "chunking"
        database.rag_update_status(file_id, "chunking")

        # 6. Read extracted.json to get extraction data for chunking
        import json as json_module
        extracted_path = Path(extraction_result["extracted_path"])
        with open(extracted_path, 'r') as f:
            extracted_data = json_module.load(f)

        # 6.5. Check extraction limits
        char_count = extracted_data.get("char_count", 0)
        if char_count > MAX_EXTRACTED_CHARS_PER_FILE:
            error_msg = f"File too large: {char_count} chars exceeds limit of {MAX_EXTRACTED_CHARS_PER_FILE}"
            database.rag_set_error(file_id, error_msg, status="error")
            raise Exception(error_msg)

        # 7. Process chunking (create chunks from extraction data)
        chunking_result = rag_processing.process_file_chunking(
            file_id=file_id,
            session_id=session_id,
            original_name=file_record["original_name"],
            extraction_result=extracted_data,
            derived_dir=derived_dir
        )

        # 7.5. Check chunk limits
        chunk_count = chunking_result.get("chunk_count", 0)
        if chunk_count > MAX_CHUNKS_PER_FILE:
            error_msg = f"Too many chunks: {chunk_count} exceeds limit of {MAX_CHUNKS_PER_FILE}"
            database.rag_set_error(file_id, error_msg, status="error")
            raise Exception(error_msg)

        # 8. Update Database with Chunking Metadata
        database.rag_update_chunking(
            file_id=file_id,
            chunks_path=chunking_result["chunks_path"],
            chunk_count=chunking_result["chunk_count"],
            page_count=extracted_data["page_count"],
            char_count=extracted_data["char_count"],
            status="chunked"
        )

        return {
            "ok": True,
            "file_id": file_id,
            "status": "chunked",
            "page_count": extracted_data["page_count"],
            "char_count": extracted_data["char_count"],
            "chunk_count": chunking_result["chunk_count"],
            "extracted_path": extraction_result["extracted_path"],
            "chunks_path": chunking_result["chunks_path"]
        }

    except rag_processing.ExtractionError as e:
        # Handle extraction/chunking errors gracefully
        error_msg = str(e)
        database.rag_set_error(file_id, error_msg, status="error")

        raise HTTPException(status_code=500, detail=f"processing_failed: {error_msg}")

    except Exception as e:
        # Unexpected errors
        error_msg = f"Unexpected error: {str(e)}"
        database.rag_set_error(file_id, error_msg, status="error")

        raise HTTPException(status_code=500, detail=error_msg)


@router.post("/index_session")
async def index_session(request: Request, session_id: str, force: bool = False):
    """
    Index all chunked files in a session to vectors (synchronous).

    Args:
        session_id: Session ID
        force: Force re-indexing of already indexed files

    Returns:
        Summary of indexing results
    """
    data_dir = _data_dir(request)

    try:
        result = rag_vector.index_session(session_id, data_dir, force=force)
        return {"ok": True, **result}

    except rag_vector.VectorIndexError as e:
        raise HTTPException(status_code=400, detail=str(e))

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Indexing failed: {str(e)}")


@router.post("/index_start")
async def index_start(request: Request, session_id: str, force: bool = False):
    """
    Start async indexing of all chunked files in a session.
    Returns immediately with job state.

    Args:
        session_id: Session ID
        force: Force re-indexing of already indexed files (optional, default false)

    Returns:
        Job state with state="running"
    """
    data_dir = _data_dir(request)
    job_state = _get_job_state(session_id)

    # Check if already running
    if job_state["state"] == "running":
        raise HTTPException(status_code=400, detail="indexing_already_running")

    # Initialize and start background task
    _update_job_state(
        session_id,
        state="running",
        cancel_requested=False,
        total_files=0,
        done_files=0,
        current_file_id=None,
        current_file_name=None,
        message="Starting...",
    )

    # Start in background thread
    thread = threading.Thread(
        target=_index_session_background, args=(session_id, data_dir, force), daemon=True
    )
    thread.start()

    return {"ok": True, "state": "running", "message": "Indexing started"}


@router.get("/index_status")
async def index_status(session_id: str):
    """
    Get status of async indexing job for a session.

    Args:
        session_id: Session ID

    Returns:
        Job state with state, file counts, current file, message, and timestamp
    """
    state = _get_job_state(session_id)
    return {
        "ok": True,
        "state": state["state"],
        "total_files": state["total_files"],
        "done_files": state["done_files"],
        "current_file_id": state["current_file_id"],
        "current_file_name": state["current_file_name"],
        "message": state["message"],
        "updated_at": state["updated_at"],
    }




@router.get("/index_events")
async def index_events(session_id: str):
    """
    Server-Sent Events (SSE) stream for real-time indexing progress.
    Emits index_status payload every 500ms while job is running.
    """
    async def event_generator():
        """Generate SSE events for indexing progress."""
        while True:
            state = _get_job_state(session_id)
            
            # Build the same payload as /rag/index_status
            payload = {
                "ok": True,
                "state": state["state"],
                "total_files": state["total_files"],
                "done_files": state["done_files"],
                "current_file_id": state["current_file_id"],
                "current_file_name": state["current_file_name"],
                "message": state["message"],
                "updated_at": state["updated_at"],
            }
            
            # Emit SSE event
            yield f"event: index_status\n"
            yield f"data: {json.dumps(payload)}\n\n"
            
            # Stop if job is finished
            if state["state"] in ["done", "cancelled", "error"]:
                break
            
            # Sleep before next update
            await asyncio.sleep(0.5)
    
    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.post("/index_cancel")
async def index_cancel(session_id: str):
    """
    Cancel async indexing for a session.
    Stops after the current file finishes.

    Args:
        session_id: Session ID

    Returns:
        Success confirmation
    """
    state = _get_job_state(session_id)

    if state["state"] != "running":
        raise HTTPException(status_code=400, detail="no_job_running")

    # Set cancel flag
    with _jobs_lock:
        if session_id in _jobs:
            _jobs[session_id]["cancel_requested"] = True

    return {"ok": True, "message": "Cancel requested"}


# ------------------------------
# Ingest Endpoints (Extract + Chunk + Index)
# ------------------------------

class IngestStartRequest(BaseModel):
    session_id: str
    file_ids: List[str]
    force: bool = False


@router.post("/ingest_start")
async def ingest_start(request: Request, body: IngestStartRequest):
    """
    Start async ingest job for specified files.
    Processes each file through extract → chunk → index phases.

    Args:
        session_id: Session ID
        file_ids: List of file IDs to ingest
        force: Force re-processing of already processed files

    Returns:
        Job state with state="running"
    """
    data_dir = _data_dir(request)
    job_state = _get_ingest_job_state(body.session_id)

    # Check if already running
    if job_state["state"] == "running":
        raise HTTPException(status_code=400, detail="ingest_already_running")

    # Validate files exist and belong to session
    valid_files = []
    for file_id in body.file_ids:
        file_record = database.rag_get_file(file_id)
        if not file_record:
            continue
        if file_record["session_id"] != body.session_id:
            continue
        valid_files.append(file_id)

    if not valid_files:
        raise HTTPException(status_code=400, detail="no_valid_files")

    # Initialize and start background task
    _update_ingest_job_state(
        body.session_id,
        state="running",
        phase="upload",
        cancel_requested=False,
        total_files=len(valid_files),
        done_files=0,
        current_file_id=None,
        current_file_name=None,
        message="Starting ingest...",
        error=None,
    )

    # Start in background thread
    thread = threading.Thread(
        target=_ingest_files_background,
        args=(body.session_id, valid_files, data_dir, body.force),
        daemon=True
    )
    thread.start()

    return {"ok": True, "state": "running"}


@router.get("/ingest_events")
async def ingest_events(session_id: str):
    """
    Server-Sent Events (SSE) stream for real-time ingest progress.
    Emits ingest_status events every 300-500ms while job is active.

    Uses canonical SSE schema from CLAUDE.md:
    - event_type: "ingest_status"
    - state: running|done|error|cancelled
    - phase: extract|chunk|index
    - total_files, done_files, current_file_name
    - message, updated_at, error
    """
    async def event_generator():
        """Generate SSE events for ingest progress."""
        while True:
            state = _get_ingest_job_state(session_id)

            # Build canonical SSE payload
            payload = {
                "event_type": "ingest_status",
                "state": state["state"],
                "phase": state["phase"],
                "total_files": state["total_files"],
                "done_files": state["done_files"],
                "current_file_name": state["current_file_name"],
                "message": state["message"],
                "updated_at": state["updated_at"],
                "error": state["error"],
            }

            # Emit SSE event
            yield f"data: {json.dumps(payload)}\n\n"

            # Stop if job is finished
            if state["state"] in ["done", "cancelled", "error"]:
                break

            # Sleep before next update (300-500ms range)
            await asyncio.sleep(0.4)

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.post("/ingest_cancel")
async def ingest_cancel(session_id: str):
    """
    Cancel async ingest for a session.
    Stops after the current file phase finishes.

    Args:
        session_id: Session ID

    Returns:
        Success confirmation
    """
    state = _get_ingest_job_state(session_id)

    if state["state"] != "running":
        raise HTTPException(status_code=400, detail="no_ingest_running")

    # Set cancel flag
    with _ingest_jobs_lock:
        if session_id in _ingest_jobs:
            _ingest_jobs[session_id]["cancel_requested"] = True

    return {"ok": True, "message": "Ingest cancel requested"}


class QueryRequest(BaseModel):
    session_id: str
    query: str
    top_k: int = 5


class SettingsRequest(BaseModel):
    rag_enabled: Optional[bool] = None
    auto_index: Optional[bool] = None


class FileActiveRequest(BaseModel):
    file_id: str
    is_active: bool


@router.post("/query")
async def query_vectors(request: Request, body: QueryRequest):
    """
    Query vectors by similarity.

    Args:
        session_id: Session ID
        query: Query text
        top_k: Number of results (default 5)

    Returns:
        List of matches with chunk text, metadata, distance
    """
    data_dir = _data_dir(request)

    try:
        # Clamp top_k to limits
        if body.top_k < 1:
            raise HTTPException(status_code=400, detail="top_k must be >= 1")
        clamped_top_k = min(body.top_k, MAX_TOP_K)

        results = rag_vector.query(
            body.session_id,
            body.query,
            clamped_top_k,
            data_dir
        )
        return {"ok": True, "results": results}

    except rag_vector.VectorIndexError as e:
        raise HTTPException(status_code=400, detail=str(e))

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Query failed: {str(e)}")


@router.post("/injection_preview")
async def injection_preview(request: Request, body: QueryRequest):
    """
    Preview what would be injected into chat without generation.
    Returns context blocks and sources for debugging/preview.
    """
    data_dir = _data_dir(request)

    try:
        # Query vectors
        results = rag_vector.query(
            body.session_id,
            body.query,
            body.top_k,
            data_dir,
            truncate_chars=None
        )

        # Build blocks
        context_block = rag_vector.build_rag_context_block(results)
        sources_block = rag_vector.build_sources_block(results)

        # Return preview (limit context to first 400 chars)
        return {
            "ok": True,
            "hits": len(results),
            "context_chars": len(context_block),
            "sources": sources_block,
            "context_preview": context_block[:400] if context_block else ""
        }

    except rag_vector.VectorIndexError as e:
        raise HTTPException(status_code=400, detail=str(e))

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Preview failed: {str(e)}")


@router.get("/settings")
async def get_settings(session_id: str):
    """
    Get RAG settings for a session.
    Returns rag_enabled and auto_index flags.
    """
    settings = database.rag_get_session_settings(session_id)
    return {
        "ok": True,
        "rag_enabled": settings.get("rag_enabled", 1),
        "auto_index": settings.get("auto_index", 1)
    }


@router.post("/settings")
async def update_settings(session_id: str, body: SettingsRequest):
    """
    Update RAG settings for a session.
    Only specified fields are updated (rag_enabled, auto_index).
    """
    rag_enabled = body.rag_enabled if body.rag_enabled is not None else None
    auto_index = body.auto_index if body.auto_index is not None else None

    database.rag_set_session_settings(session_id, rag_enabled, auto_index)

    settings = database.rag_get_session_settings(session_id)
    return {
        "ok": True,
        "rag_enabled": settings.get("rag_enabled", 1),
        "auto_index": settings.get("auto_index", 1)
    }


@router.post("/file_active")
async def set_file_active(session_id: str, body: FileActiveRequest):
    """
    Toggle active status of a file in a session.
    Validates that the file belongs to the session.
    """
    # 1. Get File Metadata
    file_record = database.rag_get_file(body.file_id)

    if not file_record:
        raise HTTPException(status_code=404, detail="file_not_found")

    # 2. Validate Session Ownership
    if file_record["session_id"] != session_id:
        raise HTTPException(status_code=403, detail="session_mismatch")

    # 3. Set Active Status
    database.rag_set_file_active(session_id, body.file_id, body.is_active)

    return {"ok": True}
