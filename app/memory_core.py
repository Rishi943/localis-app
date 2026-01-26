"""app/memory_core.py
Core Memory Module

NOTE: This file is maintained as the single memory module for the app.
"""

from dataclasses import dataclass
from datetime import datetime
import re
import json
from typing import Dict, List, Optional, Set, Literal, Any, Union, Tuple

from . import database

# --- SOFT DEPENDENCY CHECK ---
try:
    import numpy as np
    NUMPY_AVAILABLE = True
except ImportError:
    np = None
    NUMPY_AVAILABLE = False
    print("[MEMORY_CORE] Warning: 'numpy' not found. Vector memory disabled.")

# ------------------------------------------------------------------------------
# Data Structures
# ------------------------------------------------------------------------------
MemoryAuthority = Literal["user_explicit", "user_implicit", "assistant_inferred", "imported"]
MemoryIntent = Literal["identity", "preference", "task_state", "factual_knowledge", "reference_note"]
MemorySource = Literal["user", "assistant", "agent", "import"]


@dataclass
class MemoryItem:
    content: str
    intent: MemoryIntent
    authority: MemoryAuthority
    source: MemorySource
    created_at: datetime
    id: Optional[Union[str, int]] = None
    key: Optional[str] = None
    origin_session_id: Optional[str] = None
    valid_from: Optional[datetime] = None
    valid_until: Optional[datetime] = None
    score: float = 0.0  # relevance score


@dataclass
class MemoryProposal:
    content: str
    intent: MemoryIntent
    authority: MemoryAuthority
    source: MemorySource
    target: Literal["tier_a", "tier_b"]
    confidence: float
    reason: str
    should_write: bool = True
    key: Optional[str] = None
    valid_until: Optional[datetime] = None


# ------------------------------------------------------------------------------
# Configuration
# ------------------------------------------------------------------------------
TIER_A_KEYS: Set[str] = {"preferred_name", "location", "timezone", "language_preferences"}
HARD_LIMITS = {"max_retrieval_items": 8, "max_identity_items_in_context": 4}
MAX_TIER_B_CHARS = 1200
EMBEDDING_MODEL_NAME = "BAAI/bge-small-en-v1.5"
VECTOR_SIMILARITY_CUTOFF = 0.35

# Implicit Tier-B learning (heuristic-only) - DISABLED by default in new architecture
AUTO_TIER_B_ENABLED = False

# Tier-B list-like keys: store as a bullet list string and merge/append on write
BULLET_LIST_KEYS: Set[str] = {
    "interests",
    "projects",
    "goals",
    "habits_routines",
    "media_preferences",
    "values",
    "traits",
    "assistant_interaction_preferences",
    "misc",
}
BULLET_LIST_MAX_ITEMS = 50


# ------------------------------------------------------------------------------
# Embedding Logic (CPU)
# ------------------------------------------------------------------------------
_EMBEDDER = None


def get_embedder():
    """Lazy loader for SentenceTransformer with failure handling."""
    global _EMBEDDER
    if _EMBEDDER is None:
        try:
            from sentence_transformers import SentenceTransformer

            print(f"[MEMORY_CORE] Loading embedding model {EMBEDDING_MODEL_NAME} on CPU...")
            _EMBEDDER = SentenceTransformer(EMBEDDING_MODEL_NAME, device="cpu")
        except ImportError:
            print("[MEMORY_CORE] Warning: 'sentence-transformers' not found. Vector memory disabled.")
            return None
        except Exception as e:
            print(f"[MEMORY_CORE] Error loading model: {e}")
            return None
    return _EMBEDDER


def embed_text(text: str) -> Optional[List[float]]:
    if not NUMPY_AVAILABLE:
        return None
    model = get_embedder()
    if not model:
        return None
    try:
        vec = model.encode(text, normalize_embeddings=True, convert_to_numpy=True)
        return vec.tolist()
    except Exception as e:
        print(f"[MEMORY_CORE] Embed error: {e}")
        return None


def pack_embedding(vec: List[float]) -> bytes:
    if not NUMPY_AVAILABLE or not vec:
        return b""
    return np.array(vec, dtype=np.float32).tobytes()


def unpack_embedding(blob: bytes) -> Any:
    if not NUMPY_AVAILABLE:
        return None
    return np.frombuffer(blob, dtype=np.float32)


# ------------------------------------------------------------------------------
# Internal Helpers
# ------------------------------------------------------------------------------
def log_event(event: str, payload: dict, session_id: Optional[str] = None) -> None:
    try:
        # print(f"[MEMORY_CORE] {event} | {payload.get('key', '')} {payload.get('reason', '')}")
        database.add_memory_event(event, payload, session_id)
    except Exception as e:
        print(f"[MEMORY_CORE] Log error: {e}")


def normalize_identity_value(key: str, value: str) -> str:
    return value.strip() if value else ""


def format_identity_for_prompt(identity: Dict[str, str]) -> str:
    if not identity:
        return ""
    lines = ["[USER IDENTITY (Tier-A)]"]
    for key in sorted(identity.keys()):
        val = identity[key]
        label = key.replace("_", " ").capitalize()
        lines.append(f"* {label}: {val}")
    return "\n".join(lines)


def _clean_phrase(s: str) -> str:
    """Conservative cleanup for extracted phrases."""
    if not s:
        return ""
    out = s.strip()
    out = out.split("\n", 1)[0]
    out = re.split(r"[.!?]", out, maxsplit=1)[0].strip()
    out = out.strip(" \t\r\"'`“”‘’()[]{}")
    out = re.sub(r"\s+", " ", out).strip()
    out = re.sub(r"[,:;)\]]+$", "", out).strip()
    if len(out) < 2:
        return ""
    return out


def _merge_bullets(existing: str, new_items: List[str]) -> str:
    """Merge bullet-list memories."""

    def parse_existing_items(raw: str) -> List[str]:
        if not raw or not raw.strip():
            return []
        t = raw.strip()
        # Legacy JSON handling
        if t[:1] in ("[", "{"):
            try:
                obj = json.loads(t)
                if isinstance(obj, list):
                    return [_clean_phrase(str(x)) for x in obj if _clean_phrase(str(x))]
                if isinstance(obj, dict):
                    out = []
                    for _, v in obj.items():
                        if isinstance(v, list):
                            out.extend([_clean_phrase(str(x)) for x in v if _clean_phrase(str(x))])
                        elif isinstance(v, str):
                             if _clean_phrase(v): out.append(_clean_phrase(v))
                    return out
            except Exception:
                pass

        lines = [ln.strip() for ln in t.splitlines() if ln.strip()]
        bullet_items = []
        for ln in lines:
            if ln.startswith("-"):
                item = _clean_phrase(ln[1:].strip())
                if item:
                    bullet_items.append(item)

        if bullet_items:
            return bullet_items
        legacy = _clean_phrase(t)
        return [legacy] if legacy else []

    existing_items = parse_existing_items(existing)

    # Dedupe case-insensitively
    seen = set(x.lower() for x in existing_items)
    merged = list(existing_items)

    for it in (new_items or []):
        c = _clean_phrase(str(it))
        if c and c.lower() not in seen:
            merged.append(c)
            seen.add(c.lower())

    # Keep newest
    if len(merged) > BULLET_LIST_MAX_ITEMS:
        merged = merged[-BULLET_LIST_MAX_ITEMS :]

    return "\n".join([f"- {it}" for it in merged])


def _coerce_to_items(value: Optional[str]) -> List[str]:
    """Convert a stored/proposed value into a list of items."""
    if not value or not str(value).strip():
        return []
    t = str(value).strip()

    # Simple split if looks like a comma list, else single item
    if "," in t and not t.startswith(("-", "[", "{")):
        return [x.strip() for x in t.split(",") if x.strip()]

    # Re-use merge parser logic for consistency would be better, but simple fallback:
    c = _clean_phrase(t)
    return [c] if c else []


# ------------------------------------------------------------------------------
# NEW: Tool-Facing Public API
# ------------------------------------------------------------------------------

def tool_memory_retrieve(session_id: str, query: str, k: int = 8) -> str:
    """
    Retrieves a formatted block of memory relevant to the query.
    Combines deterministic Tier-A identity with hybrid Tier-B retrieval (Vector + KV).
    """
    # 1. Tier-A: Deterministic Identity
    identity_context = get_identity_context(session_id)
    identity_block = format_identity_for_prompt(identity_context)

    # 2. Tier-B: Hybrid Retrieval
    candidates: List[MemoryItem] = []

    # 2a. Vector Retrieval
    if NUMPY_AVAILABLE:
        vector_results = retrieve_vector_memory(query, session_id, k=k)
        candidates.extend(vector_results)

    # 2b. KV Retrieval (Keyword/Intent Matching)
    kv_results = _retrieve_kv_memory_scored(query, k=k)
    candidates.extend(kv_results)

    # 3. Merge, Dedupe, and Rank
    # We use a simple scoring heuristic: if it came from both, sum score.
    # Dedupe by content (normalized).
    merged_map: Dict[str, MemoryItem] = {}

    for item in candidates:
        # Normalize content for deduplication
        norm_content = re.sub(r"\s+", " ", item.content).strip().lower()

        if norm_content in merged_map:
            # Boost score if found in multiple retrieval methods
            merged_map[norm_content].score += item.score
        else:
            merged_map[norm_content] = item

    final_list = list(merged_map.values())
    # Sort by descending relevance score
    final_list.sort(key=lambda x: x.score, reverse=True)

    # Cap at k items
    top_items = final_list[:k]

    # Log event
    log_event("tool_memory_retrieve", {
        "query": query,
        "found": len(top_items),
        "sources": [("vector" if i.id else "kv") for i in top_items]
    }, session_id)

    # 4. Format Output
    output_parts = []

    if identity_block:
        output_parts.append(identity_block)

    if top_items:
        lines = ["[RELEVANT MEMORY (Tier-B)]"]
        current_chars = 0
        for item in top_items:
            # Truncate overly long items for display
            display_content = item.content
            if len(display_content) > 300:
                display_content = display_content[:297] + "..."

            line = f"* {display_content}"
            if item.key and item.key != "misc":
                line = f"* [{item.key}] {display_content}"

            if current_chars + len(line) > MAX_TIER_B_CHARS:
                break

            lines.append(line)
            current_chars += len(line) + 1
        output_parts.append("\n".join(lines))

    if not output_parts:
        return "No relevant memories found."

    return "\n\n".join(output_parts)


def tool_memory_write(
    session_id: str,
    key: Optional[str],
    value: str,
    intent: str,
    authority: str,
    source: str,
    confidence: float,
    reason: str,
    target: str
) -> Dict[str, Any]:
    """
    Validates and writes memory to the database.
    """
    # 1. Validation & Truncation
    if not value or not value.strip():
        return {"ok": False, "skipped_reason": "empty_value"}

    clean_val = value.strip()
    if len(clean_val) > 4000:
        clean_val = clean_val[:4000] # Safe upper bound for DB text

    safe_key = key.strip().lower().replace(" ", "_") if key else None

    # 2. Routing based on Target
    if target == "tier_a":
        # Strict validation for Identity
        if safe_key not in TIER_A_KEYS:
            return {"ok": False, "skipped_reason": f"invalid_key_tier_a: {safe_key}"}
        if authority != "user_explicit":
             # Enforce high authority for core identity
            return {"ok": False, "skipped_reason": "low_authority_tier_a"}

        database.upsert_user_memory(safe_key, clean_val, category="identity")
        meta = {
            "authority": authority,
            "source": source,
            "intent": "identity",
            "origin_session_id": session_id,
            "reason": reason
        }
        database.upsert_user_memory_meta(safe_key, meta)
        log_event("tool_write_tier_a", {"key": safe_key}, session_id)
        return {"ok": True, "key": safe_key}

    elif target == "tier_b":
        # Default to 'misc' if key is missing or weird, but prefer passed key
        final_key = safe_key if safe_key else "misc"

        # Check against allowed keys in DB schema if possible, or soft allow
        if final_key not in database.ALLOWED_AUTO_MEMORY_KEYS:
             # Fallback to misc if strictly outside allowed universe?
             # For now, we trust the DB layer to handle category mapping,
             # but we ensure key safety.
             if not re.match(r"^[a-z0-9_]+$", final_key):
                 final_key = "misc"

        # Handle list merging for specific keys
        if final_key in BULLET_LIST_KEYS:
            existing = database.get_user_memory_value(final_key)
            new_items = _coerce_to_items(clean_val)
            clean_val = _merge_bullets(existing or "", new_items)

        database.upsert_user_memory(final_key, clean_val, category="auto")

        meta = {
            "authority": authority,
            "source": source,
            "intent": intent,
            "origin_session_id": session_id,
            "reason": reason,
            "confidence": confidence,
        }
        database.upsert_user_memory_meta(final_key, meta)

        # Also index in vector store for retrieval
        add_vector_memory(clean_val, session_id, intent, authority, source, None)

        log_event("tool_write_tier_b", {"key": final_key}, session_id)
        return {"ok": True, "key": final_key}

    return {"ok": False, "skipped_reason": "invalid_target"}


def tool_memory_forget(session_id: str, key: str) -> Dict[str, Any]:
    """
    Deletes a memory key.
    """
    if not key:
        return {"ok": False}

    success = forget_memory(key, session_id)
    return {"ok": success}


# ------------------------------------------------------------------------------
# KV Scoring Logic
# ------------------------------------------------------------------------------

def _retrieve_kv_memory_scored(query: str, k: int = 8) -> List[MemoryItem]:
    """
    Retrieves all KV memories, scores them by keyword overlap, and returns top K.
    """
    all_memories = database.get_extended_user_memories_with_meta()
    if not all_memories:
        return []

    # Tokenize query: lower, ignore short words
    query_terms = set(w for w in re.findall(r"\w{3,}", query.lower()) if w)
    if not query_terms:
        return []

    scored_candidates = []

    for item in all_memories:
        key_raw = item.get("key", "")
        val_raw = item.get("value", "")
        meta = item.get("meta") or {}

        # Basic Scoring
        score = 0

        # 1. Key Intent Match (Boost)
        # If query contains "book", boost "media_preferences"
        key_normalized = key_raw.replace("_", " ")
        if any(term in key_normalized for term in query_terms):
            score += 2.0

        # 2. Content Overlap
        content_normalized = val_raw.lower()
        overlap_count = sum(1 for term in query_terms if term in content_normalized)
        score += overlap_count * 1.0

        if score > 0:
            scored_candidates.append(
                MemoryItem(
                    content=val_raw,
                    intent=meta.get("intent", "reference_note"),
                    authority=meta.get("authority", "imported"),
                    source=meta.get("source", "import"),
                    created_at=datetime.utcnow(),
                    key=key_raw,
                    score=score
                )
            )

    # Sort desc
    scored_candidates.sort(key=lambda x: x.score, reverse=True)
    return scored_candidates[:k]


# ------------------------------------------------------------------------------
# Existing Logic (Vector & Legacy)
# ------------------------------------------------------------------------------

def parse_memory_command(user_text: str) -> Optional[Dict[str, str]]:
    text = user_text.strip()
    if text.lower().startswith("/remember "):
        payload = text[10:].strip()
        match = re.match(r"^([a-zA-Z0-9_]+)\s*[=:]\s*(.+)$", payload)
        if match:
            return {"cmd": "remember", "key": match.group(1), "value": match.group(2)}
        else:
            return {"cmd": "remember", "key": "misc", "value": payload}
    elif text.lower().startswith("/forget "):
        return {"cmd": "forget", "key": text[8:].strip()}
    return None


def get_identity_context(session_id: str) -> Dict[str, str]:
    raw_rows = database.get_core_user_memories_with_meta()
    identity: Dict[str, str] = {}
    for row in raw_rows:
        if row["key"] and row["value"]:
            identity[row["key"]] = normalize_identity_value(row["key"], row["value"])
    return identity


def add_vector_memory(
    content: str,
    session_id: Optional[str],
    intent: MemoryIntent,
    authority: MemoryAuthority,
    source: MemorySource,
    valid_until: Optional[datetime],
) -> int:
    vec = embed_text(content)
    if not vec:
        log_event("vector_skip", {"reason": "embedding_failed_or_disabled"}, session_id)
        return -1

    blob = pack_embedding(vec)
    meta = {
        "intent": intent,
        "authority": authority,
        "source": source,
        "origin_session_id": session_id,
        "valid_from": datetime.utcnow().isoformat(),
        "valid_until": valid_until.isoformat() if valid_until else None,
    }
    row_id = database.add_vector_memory_item(content, blob, meta)
    # log_event("vector_memory_added", {"id": row_id}, session_id)
    return row_id


def retrieve_vector_memory(query: str, session_id: str, k: int = 5) -> List[MemoryItem]:
    if not NUMPY_AVAILABLE:
        return []

    query_vec = embed_text(query)
    if not query_vec:
        return []

    q_arr = np.array(query_vec, dtype=np.float32)
    candidates = database.list_vector_memory_items(limit=2000)
    scored_items = []

    for row in candidates:
        if not row["embedding"]:
            continue
        try:
            item_vec = unpack_embedding(row["embedding"])
            score = float(np.dot(q_arr, item_vec))
            if score >= VECTOR_SIMILARITY_CUTOFF:
                meta = row["meta"]
                scored_items.append(
                    MemoryItem(
                        id=row["id"],
                        content=row["content"],
                        intent=meta.get("intent", "reference_note"),
                        authority=meta.get("authority", "imported"),
                        source=meta.get("source", "import"),
                        created_at=datetime.utcnow(),
                        score=score
                    )
                )
        except Exception:
            pass

    scored_items.sort(key=lambda x: x.score, reverse=True)
    return scored_items[:k]


def propose_memory_write(user_text: str, session_id: str) -> Optional[MemoryProposal]:
    """Legacy/Slash-Command Entry point."""
    cmd = parse_memory_command(user_text)
    if cmd and cmd["cmd"] == "remember":
        key = cmd["key"]
        if key in TIER_A_KEYS:
            return MemoryProposal(
                content=cmd["value"],
                intent="identity",
                authority="user_explicit",
                source="user",
                target="tier_a",
                confidence=1.0,
                reason="explicit_command",
                key=key,
            )
        else:
            return MemoryProposal(
                content=cmd["value"],
                intent="reference_note",
                authority="user_explicit",
                source="user",
                target="tier_b",
                confidence=1.0,
                reason="explicit_command",
                key=key,
            )

    # NOTE: Implicit heuristics removed/disabled to satisfy "Explicit Invocation Only" rule.
    return None


def propose_memory_writes(user_text: str, session_id: str) -> List[MemoryProposal]:
    """Wrapper for slash commands."""
    p = propose_memory_write(user_text, session_id)
    return [p] if p else []


def apply_memory_write(proposal: MemoryProposal, session_id: Optional[str] = None) -> bool:
    """Legacy applicator (delegates to new tool function where possible)."""
    if not proposal.should_write:
        return False

    res = tool_memory_write(
        session_id=session_id or "unknown",
        key=proposal.key,
        value=proposal.content,
        intent=proposal.intent,
        authority=proposal.authority,
        source=proposal.source,
        confidence=proposal.confidence,
        reason=proposal.reason,
        target=proposal.target
    )
    return res.get("ok", False)


def forget_memory(key: str, session_id: Optional[str] = None) -> bool:
    d1 = database.delete_user_memory(key)
    d2 = database.delete_user_memory_meta(key)
    log_event("memory_forget", {"key": key}, session_id)
    return d1 or d2


def build_chat_context_v2(
    session_id: str,
    system_prompt: str,
    chat_messages: List[Dict[str, Any]],
    user_prompt: str,
) -> List[Dict[str, str]]:
    """
    Constructs the prompt context.
    CRITICAL CHANGE: No longer performs automatic vector retrieval.
    Only injects:
      1. System Prompt
      2. Tier-A Identity (Deterministic)
      3. Chat History
      4. User Prompt
    """
    # 1) Identity (Tier-A)
    identity = get_identity_context(session_id)
    identity_block = format_identity_for_prompt(identity)
    full_system = system_prompt
    if identity_block:
        full_system += "\n\n" + identity_block

    # 2) History & User Prompt (Standard)
    messages: List[Dict[str, str]] = [{"role": "system", "content": full_system}]

    for msg in chat_messages:
        messages.append({"role": str(msg["role"]), "content": str(msg["content"])})

    messages.append({"role": "user", "content": user_prompt})

    return messages
