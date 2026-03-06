# app/rag_processing.py
"""
RAG file processing: extraction and chunking for uploaded documents.
"""
from __future__ import annotations

import csv
import json
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Any, Optional

# PDF extraction (try pypdf first, fallback to PyPDF2)
try:
    from pypdf import PdfReader
except ImportError:
    try:
        from PyPDF2 import PdfReader
    except ImportError:
        PdfReader = None

# DOCX extraction
try:
    from docx import Document as DocxDocument
except ImportError:
    DocxDocument = None


class ExtractionError(Exception):
    """Raised when text extraction fails."""
    pass


def extract_text_from_pdf(file_path: Path) -> Dict[str, Any]:
    """
    Extract text from PDF file.
    Returns dict with pages array: [{page: 1, text: "..."}, ...]
    """
    if PdfReader is None:
        raise ExtractionError("PDF support not available (install pypdf or PyPDF2)")

    try:
        reader = PdfReader(str(file_path))
        pages = []

        for i, page in enumerate(reader.pages, start=1):
            text = page.extract_text() or ""
            pages.append({"page": i, "text": text})

        return {
            "page_count": len(pages),
            "char_count": sum(len(p["text"]) for p in pages),
            "pages": pages
        }
    except Exception as e:
        raise ExtractionError(f"PDF extraction failed: {str(e)}")


def extract_text_from_docx(file_path: Path) -> Dict[str, Any]:
    """
    Extract text from DOCX file.
    Returns dict with single page containing all paragraphs joined with newlines.
    """
    if DocxDocument is None:
        raise ExtractionError("DOCX support not available (install python-docx)")

    try:
        doc = DocxDocument(str(file_path))
        paragraphs = [para.text for para in doc.paragraphs]
        text = "\n".join(paragraphs)

        return {
            "page_count": 1,
            "char_count": len(text),
            "pages": [{"page": 1, "text": text}]
        }
    except Exception as e:
        raise ExtractionError(f"DOCX extraction failed: {str(e)}")


def extract_text_from_csv(file_path: Path) -> Dict[str, Any]:
    """
    Extract text from CSV file.
    Converts to text lines like "col1 | col2 | col3" for each row.
    Limits cell width to prevent extremely wide cells.
    """
    MAX_CELL_WIDTH = 1000

    try:
        with open(file_path, 'r', encoding='utf-8', errors='replace') as f:
            reader = csv.reader(f)
            lines = []

            for row in reader:
                # Truncate extremely wide cells
                truncated = [cell[:MAX_CELL_WIDTH] for cell in row]
                line = " | ".join(truncated)
                lines.append(line)

            text = "\n".join(lines)

            return {
                "page_count": 1,
                "char_count": len(text),
                "pages": [{"page": 1, "text": text}]
            }
    except Exception as e:
        raise ExtractionError(f"CSV extraction failed: {str(e)}")


def extract_text_from_text(file_path: Path) -> Dict[str, Any]:
    """
    Extract text from plain text file (TXT, MD).
    Returns dict with single page containing entire file content.
    """
    try:
        with open(file_path, 'r', encoding='utf-8', errors='replace') as f:
            text = f.read()

        return {
            "page_count": 1,
            "char_count": len(text),
            "pages": [{"page": 1, "text": text}]
        }
    except Exception as e:
        raise ExtractionError(f"Text extraction failed: {str(e)}")


def extract_text(file_path: Path, mime_type: str) -> Dict[str, Any]:
    """
    Extract text from file based on MIME type.

    Args:
        file_path: Path to the file
        mime_type: MIME type of the file

    Returns:
        Dict with page_count, char_count, and pages array

    Raises:
        ExtractionError: If extraction fails
    """
    # Determine extraction method based on MIME type or extension
    ext = file_path.suffix.lower()

    if mime_type == 'application/pdf' or ext == '.pdf':
        return extract_text_from_pdf(file_path)

    elif mime_type == 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' or ext == '.docx':
        return extract_text_from_docx(file_path)

    elif mime_type == 'text/csv' or ext == '.csv':
        return extract_text_from_csv(file_path)

    elif mime_type in ('text/plain', 'text/markdown') or ext in ('.txt', '.md'):
        return extract_text_from_text(file_path)

    else:
        raise ExtractionError(f"Unsupported file type: {mime_type} ({ext})")


def create_extracted_json(
    file_id: str,
    session_id: str,
    original_name: str,
    mime: str,
    extraction_result: Dict[str, Any],
    output_path: Path
) -> None:
    """
    Create standardized extracted.json file.

    Args:
        file_id: File ID
        session_id: Session ID
        original_name: Original filename
        mime: MIME type
        extraction_result: Result from extract_text() containing page_count, char_count, pages
        output_path: Path where extracted.json should be written
    """
    extracted_data = {
        "file_id": file_id,
        "session_id": session_id,
        "original_name": original_name,
        "mime": mime,
        "extracted_at": datetime.utcnow().isoformat(),
        "page_count": extraction_result["page_count"],
        "char_count": extraction_result["char_count"],
        "pages": extraction_result["pages"]
    }

    # Ensure parent directory exists
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # Write JSON with pretty formatting
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(extracted_data, f, indent=2, ensure_ascii=False)


def process_file_extraction(
    file_id: str,
    session_id: str,
    original_name: str,
    mime: str,
    stored_path: Path,
    derived_dir: Path
) -> Dict[str, Any]:
    """
    Process file extraction end-to-end.

    Args:
        file_id: File ID
        session_id: Session ID
        original_name: Original filename
        mime: MIME type
        stored_path: Path to the uploaded file
        derived_dir: Directory for derived data (extracted.json, etc.)

    Returns:
        Dict with extraction metadata (page_count, char_count, extracted_path)

    Raises:
        ExtractionError: If extraction fails
    """
    # Extract text
    extraction_result = extract_text(stored_path, mime)

    # Create extracted.json
    file_derived_dir = derived_dir / file_id
    extracted_path = file_derived_dir / "extracted.json"

    create_extracted_json(
        file_id=file_id,
        session_id=session_id,
        original_name=original_name,
        mime=mime,
        extraction_result=extraction_result,
        output_path=extracted_path
    )

    return {
        "page_count": extraction_result["page_count"],
        "char_count": extraction_result["char_count"],
        "extracted_path": str(extracted_path)
    }


# Chunking configuration
CHUNK_SIZE_CHARS = 4000
CHUNK_OVERLAP_CHARS = 400


def create_chunks_with_page_mapping(
    file_id: str,
    session_id: str,
    original_name: str,
    extraction_result: Dict[str, Any]
) -> List[Dict[str, Any]]:
    """
    Create chunks from extracted pages with page offset mapping.

    Args:
        file_id: File ID
        session_id: Session ID
        original_name: Original filename
        extraction_result: Result from extract_text() with pages array

    Returns:
        List of chunk dicts with page_start, page_end, char offsets
    """
    pages = extraction_result["pages"]

    # Build full text and track page boundaries
    full_text = ""
    page_boundaries = []  # List of (page_num, start_char, end_char)

    for page_obj in pages:
        page_num = page_obj["page"]
        text = page_obj["text"]
        start_char = len(full_text)

        if full_text:  # Add separator between pages (except first)
            full_text += "\n\n"
            start_char = len(full_text)

        full_text += text
        end_char = len(full_text)

        page_boundaries.append((page_num, start_char, end_char))

    # Create overlapping chunks
    chunks = []
    chunk_idx = 0
    pos = 0

    while pos < len(full_text):
        # Determine chunk boundaries
        chunk_start = pos
        chunk_end = min(pos + CHUNK_SIZE_CHARS, len(full_text))

        # Snap to sentence boundary (avoid splitting mid-sentence)
        if chunk_end < len(full_text):
            search_start = max(chunk_end - 200, chunk_start + 100)
            best_boundary = chunk_end  # fallback: keep original
            for boundary in ['. ', '.\n', '? ', '?\n', '! ', '!\n']:
                idx = full_text.rfind(boundary, search_start, chunk_end)
                if idx != -1:
                    candidate = idx + len(boundary)
                    if candidate > search_start:
                        best_boundary = candidate
                        break
            chunk_end = best_boundary

        chunk_text = full_text[chunk_start:chunk_end]

        # Determine which pages this chunk spans
        page_start = None
        page_end = None

        for page_num, pb_start, pb_end in page_boundaries:
            if pb_start <= chunk_start < pb_end or (page_start is None and pb_end > chunk_start):
                if page_start is None:
                    page_start = page_num
            if pb_start < chunk_end <= pb_end or (pb_start < chunk_end and pb_end >= chunk_end):
                page_end = page_num

        if page_start is None:
            page_start = pages[-1]["page"]
        if page_end is None:
            page_end = pages[-1]["page"]

        chunks.append({
            "chunk_id": f"{file_id}_{chunk_idx:04d}",
            "file_id": file_id,
            "session_id": session_id,
            "source_name": original_name,
            "page_start": page_start,
            "page_end": page_end,
            "char_start": chunk_start,
            "char_end": chunk_end,
            "text": chunk_text
        })

        chunk_idx += 1
        # Move forward by chunk size minus overlap
        pos += CHUNK_SIZE_CHARS - CHUNK_OVERLAP_CHARS

        # Stop if we've reached the end
        if chunk_end >= len(full_text):
            break

    return chunks


def write_chunks_jsonl(chunks: List[Dict[str, Any]], output_path: Path) -> None:
    """
    Write chunks to JSONL file (one JSON object per line).

    Args:
        chunks: List of chunk dicts
        output_path: Path where chunks.jsonl should be written
    """
    # Ensure parent directory exists
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with open(output_path, 'w', encoding='utf-8') as f:
        for chunk in chunks:
            json.dump(chunk, f, ensure_ascii=False)
            f.write('\n')


def process_file_chunking(
    file_id: str,
    session_id: str,
    original_name: str,
    extraction_result: Dict[str, Any],
    derived_dir: Path
) -> Dict[str, Any]:
    """
    Process file chunking after extraction.

    Args:
        file_id: File ID
        session_id: Session ID
        original_name: Original filename
        extraction_result: Result from extract_text() with pages array
        derived_dir: Directory for derived data

    Returns:
        Dict with chunking metadata (chunk_count, chunks_path)

    Raises:
        ExtractionError: If chunking fails
    """
    try:
        # Create chunks with page mapping
        chunks = create_chunks_with_page_mapping(
            file_id=file_id,
            session_id=session_id,
            original_name=original_name,
            extraction_result=extraction_result
        )

        if not chunks:
            raise ExtractionError("No chunks created from extracted text")

        # Write chunks.jsonl
        file_derived_dir = derived_dir / file_id
        chunks_path = file_derived_dir / "chunks.jsonl"

        write_chunks_jsonl(chunks, chunks_path)

        return {
            "chunk_count": len(chunks),
            "chunks_path": str(chunks_path)
        }
    except Exception as e:
        raise ExtractionError(f"Chunking failed: {str(e)}")
