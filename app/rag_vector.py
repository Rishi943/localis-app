# app/rag_vector.py
"""
RAG vector indexing: embed chunks, store in Chroma, query vectors.
"""
from __future__ import annotations

import re
import json
from pathlib import Path
from typing import Dict, List, Any, Optional

from . import memory_core


# Batch size for embedding to reduce memory spikes
BATCH_SIZE = 100

# Cosine distance threshold — chunks scoring above this are filtered out as low-relevance.
# Tune this based on your embedding model (bge-small-en-v1.5 uses cosine distance).
# Lower = stricter. 1.2 is a reasonable default. Range: 0.0 (exact match only) to 2.0 (everything).
RAG_DISTANCE_THRESHOLD = 1.2

# Embedder cache to avoid re-initialization
_embedder_cache = None

def _get_cached_embedder():
    """Get embedder with module-level caching to avoid re-initialization."""
    global _embedder_cache
    if _embedder_cache is None:
        _embedder_cache = memory_core.get_embedder()
    return _embedder_cache
# Lazy import chromadb to handle Python 3.14 compatibility issues
chromadb = None
Settings = None
_import_error = None

def _import_chromadb():
    global chromadb, Settings, _import_error
    if chromadb is None and _import_error is None:
        try:
            import chromadb as _chromadb
            from chromadb.config import Settings as _Settings
            chromadb = _chromadb
            Settings = _Settings
        except Exception as e:
            _import_error = str(e)

    if _import_error:
        raise VectorIndexError(f"Chromadb unavailable: {_import_error}")

    return chromadb, Settings


class VectorIndexError(Exception):
    """Raised when vector indexing fails."""
    pass


def _safe_collection_name(session_id: str) -> str:
    """
    Sanitize session_id into a valid Chroma collection name.
    Chroma collections: [a-zA-Z0-9_-] only, max 63 chars, lowercase.
    """
    # Lowercase and replace invalid chars
    safe = re.sub(r'[^a-zA-Z0-9_-]', '_', session_id.lower())
    # Trim to max length
    safe = safe[:63]
    return safe if safe else "default"


def get_chroma_client(data_dir: Path):
    """
    Get or create a persistent Chroma client at data_dir/chroma.
    """
    chromadb_lib, Settings_cls = _import_chromadb()

    chroma_dir = data_dir / "chroma"
    chroma_dir.mkdir(parents=True, exist_ok=True)

    settings = Settings_cls(
        is_persistent=True,
        persist_directory=str(chroma_dir),
        allow_reset=True
    )
    return chromadb_lib.Client(settings)


def index_file(
    session_id: str,
    file_id: str,
    chunks_path: Path,
    data_dir: Path,
    force: bool = False
) -> int:
    """
    Index chunks from chunks.jsonl into Chroma.

    Args:
        session_id: Session ID
        file_id: File ID
        chunks_path: Path to chunks.jsonl
        data_dir: RAG data directory
        force: Re-index even if already indexed

    Returns:
        Number of chunks indexed

    Raises:
        VectorIndexError: If indexing fails
    """
    try:
        # Load chunks
        chunks = []
        with open(chunks_path, 'r') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                chunks.append(json.loads(line))

        if not chunks:
            raise VectorIndexError("No chunks found in file")

        # Get embedder
        embedder = _get_cached_embedder()
        if embedder is None:
            raise VectorIndexError("Embedder not available")

        # Extract texts and build metadata
        texts = [chunk["text"] for chunk in chunks]
        chunk_ids = [chunk["chunk_id"] for chunk in chunks]

        metadatas = []
        for chunk in chunks:
            # DEFENSIVE: Verify chunk's session_id matches requested session_id
            if chunk.get("session_id") != session_id:
                raise VectorIndexError(
                    f"Session mismatch: chunk has session_id={chunk.get('session_id')}, "
                    f"requested session_id={session_id}"
                )

            metadatas.append({
                "file_id": chunk["file_id"],
                "session_id": chunk["session_id"],
                "source_name": chunk["source_name"],
                "page_start": chunk["page_start"],
                "page_end": chunk["page_end"],
                "char_start": chunk["char_start"],
                "char_end": chunk["char_end"]
            })

        # Get Chroma client and collection
        client = get_chroma_client(data_dir)
        coll_name = _safe_collection_name(session_id)
        collection = client.get_or_create_collection(
            name=coll_name,
            metadata={"session_id": session_id}
        )

        # Process in batches to reduce memory spikes
        total_indexed = 0
        for batch_start in range(0, len(chunks), BATCH_SIZE):
            batch_end = min(batch_start + BATCH_SIZE, len(chunks))
            
            batch_texts = texts[batch_start:batch_end]
            batch_ids = chunk_ids[batch_start:batch_end]
            batch_metadatas = metadatas[batch_start:batch_end]
            
            # Embed batch
            batch_embeddings = embedder.encode(batch_texts, normalize_embeddings=True, show_progress_bar=False)
            
            # Upsert batch
            collection.upsert(
                ids=batch_ids,
                embeddings=batch_embeddings.tolist(),
                metadatas=batch_metadatas,
                documents=batch_texts
            )
            
            total_indexed = batch_end

        return total_indexed

    except Exception as e:
        raise VectorIndexError(f"Failed to index file: {str(e)}")


def index_session(
    session_id: str,
    data_dir: Path,
    force: bool = False
) -> Dict[str, Any]:
    """
    Index all non-indexed or error files in a session.

    Args:
        session_id: Session ID
        data_dir: RAG data directory
        force: Force re-indexing of all files

    Returns:
        Summary dict with total_files, indexed_files, total_chunks
    """
    from . import database

    files = database.rag_list_files(session_id)
    indexed_count = 0
    total_chunks = 0

    for file_record in files:
        # Skip files that aren't ready or already indexed
        if file_record.get("status") != "chunked":
            continue

        if not force and file_record.get("indexed_at"):
            continue

        chunks_path = file_record.get("chunks_path")
        if not chunks_path:
            continue

        try:
            chunk_count = index_file(
                session_id,
                file_record["id"],
                Path(chunks_path),
                data_dir,
                force=force
            )

            # Update DB
            database.rag_update_indexing(
                file_id=file_record["id"],
                vector_count=chunk_count,
                index_backend="chromadb",
                index_collection=_safe_collection_name(session_id)
            )

            indexed_count += 1
            total_chunks += chunk_count

        except VectorIndexError as e:
            database.rag_set_error(file_record["id"], str(e), status="error")

    return {
        "total_files": len(files),
        "indexed_files": indexed_count,
        "total_chunks": total_chunks
    }


def query(
    session_id: str,
    query_text: str,
    top_k: int,
    data_dir: Path,
    truncate_chars: Optional[int] = 240
) -> List[Dict[str, Any]]:
    """
    Query chunks by similarity.

    Args:
        session_id: Session ID
        query_text: Query text
        top_k: Number of results
        data_dir: RAG data directory

    Returns:
        List of results with chunk text, metadata, distance

    Raises:
        VectorIndexError: If query fails
    """
    try:
        # Get embedder
        embedder = _get_cached_embedder()
        if embedder is None:
            raise VectorIndexError("Embedder not available")

        # Encode query
        query_embedding = embedder.encode([query_text], normalize_embeddings=True, show_progress_bar=False)[0]

        # Get Chroma client and collection
        client = get_chroma_client(data_dir)
        coll_name = _safe_collection_name(session_id)

        try:
            collection = client.get_collection(name=coll_name)
        except Exception:
            # Collection doesn't exist (no indexed files yet)
            return []

        # Query
        results = collection.query(
            query_embeddings=[query_embedding.tolist()],
            n_results=top_k,
            include=["metadatas", "documents", "distances"]
        )

        # Format results with defensive session_id verification
        matches = []
        if results["ids"] and len(results["ids"]) > 0:
            for i, chunk_id in enumerate(results["ids"][0]):
                metadata = results["metadatas"][0][i]
                document = results["documents"][0][i]
                distance = results["distances"][0][i]

                # DEFENSIVE: Verify session_id in metadata matches request session_id
                # (collection-per-session is primary defense, this is secondary)
                if metadata.get("session_id") != session_id:
                    continue

                # Truncate text if truncate_chars specified, else use full text
                text = document[:truncate_chars] if truncate_chars and document else (document or "")

                matches.append({
                    "chunk_id": chunk_id,
                    "text": text,
                    "source_name": metadata.get("source_name", ""),
                    "page_start": metadata.get("page_start"),
                    "page_end": metadata.get("page_end"),
                    "distance": float(distance)
                })

        # Filter low-relevance matches
        pre_filter_count = len(matches)
        matches = [m for m in matches if m["distance"] < RAG_DISTANCE_THRESHOLD]
        filtered_count = pre_filter_count - len(matches)
        if filtered_count > 0:
            print(f" [RAG] Filtered {filtered_count}/{pre_filter_count} matches above distance threshold {RAG_DISTANCE_THRESHOLD}")

        # Deterministic ordering: sort by distance (asc), then chunk_id (asc)
        matches.sort(key=lambda x: (x["distance"], x["chunk_id"]))
        return matches

    except Exception as e:
        raise VectorIndexError(f"Query failed: {str(e)}")


def delete_file_vectors(
    session_id: str,
    file_id: str,
    data_dir: Path
) -> bool:
    """
    Delete all vectors for a file from the session's collection.

    Args:
        session_id: Session ID
        file_id: File ID
        data_dir: RAG data directory

    Returns:
        True if vectors were deleted, False if collection/file not found
    """
    try:
        client = get_chroma_client(data_dir)
        coll_name = _safe_collection_name(session_id)

        try:
            collection = client.get_collection(name=coll_name)
        except Exception:
            # Collection doesn't exist
            return False

        # Find and delete all vectors for this file_id
        where_filter = {"file_id": {"$eq": file_id}}
        collection.delete(where=where_filter)

        return True

    except Exception:
        # Silently fail - vectors might not exist
        return False


def delete_session_collection(session_id: str, data_dir: Path) -> bool:
    """
    Delete the entire Chroma collection for a session.

    Args:
        session_id: Session ID
        data_dir: RAG data directory

    Returns:
        True if collection was deleted, False if it didn't exist
    """
    try:
        client = get_chroma_client(data_dir)
        coll_name = _safe_collection_name(session_id)
        try:
            client.delete_collection(name=coll_name)
            return True
        except Exception:
            return False  # Collection didn't exist
    except Exception:
        return False


def build_rag_context_block(
    matches: List[Dict[str, Any]],
    *,
    max_total_chars: int = 16000,  # Increased from 6000 for richer context
    max_chunk_chars: int = 4000    # Increased from 2000 for complete chunks
) -> str:
    """
    Build a formatted RAG context block from query matches.

    Args:
        matches: List of match dicts from query()
        max_total_chars: Max total characters for entire block
        max_chunk_chars: Max characters per chunk

    Returns:
        Formatted string "[RAG CONTEXT]\n[S0] source (pp. x-y)\n..." or empty if no matches
    """
    if not matches:
        return ""

    lines = ["\n\n[RAG CONTEXT]"]
    total_len = len(lines[0])

    for i, match in enumerate(matches):
        source_name = match.get("source_name", "Unknown")
        page_start = match.get("page_start", "?")
        page_end = match.get("page_end", "?")
        text = match.get("text", "")

        # Truncate chunk text to max_chunk_chars
        chunk_text = text[:max_chunk_chars] if text else ""

        # Calculate confidence score from distance (lower distance = higher confidence)
        distance = match.get("distance", 1.0)
        confidence = round((1.0 - distance) * 100)  # Convert to 0-100 score

        # Format: [S0] source (pp. x-y) [confidence: XX%]\ntext\n
        header = f"\n[S{i}] {source_name} (pp. {page_start}-{page_end}) [confidence: {confidence}%]\n"
        block = header + chunk_text + "\n"

        # Check if adding this block would exceed budget
        if total_len + len(block) > max_total_chars:
            break

        lines.append(block)
        total_len += len(block)

    return "".join(lines) if len(lines) > 1 else ""


def build_sources_block(matches: List[Dict[str, Any]]) -> str:
    """
    Build a deduplicated sources block from query matches.

    Args:
        matches: List of match dicts from query()

    Returns:
        Formatted string "\n\n---\n\nSources:\n- source (pp. x-y)\n..." or empty if no matches
    """
    if not matches:
        return ""

    # Deduplicate by (source_name, page_start, page_end)
    seen = set()
    sources = []

    for match in matches:
        source_name = match.get("source_name", "Unknown")
        page_start = match.get("page_start", "?")
        page_end = match.get("page_end", "?")
        key = (source_name, page_start, page_end)

        if key not in seen:
            seen.add(key)
            sources.append(f"- {source_name} (pp. {page_start}-{page_end})")

    if not sources:
        return ""

    return "\n\n---\n\nSources:\n" + "\n".join(sources)
