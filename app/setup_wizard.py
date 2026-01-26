# app/setup_wizard.py
from __future__ import annotations

import gc
import os
import sys
import threading
import subprocess
from pathlib import Path
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel, Field

from . import database
from llama_cpp import Llama

DEFAULT_TUTORIAL_REPO = "johnhaul/Qwen3-0.6B-Q4_K_M-GGUF"
DEFAULT_TUTORIAL_FILE = "qwen3-0.6b-q4_k_m.gguf"

router = APIRouter(prefix="/setup", tags=["setup"])

_download_lock = threading.Lock()
_download_thread: Optional[threading.Thread] = None
_download_state: Dict[str, Any] = {
    "status": "idle",  # idle | downloading | done | error
    "repo_id": DEFAULT_TUTORIAL_REPO,
    "filename": DEFAULT_TUTORIAL_FILE,
    "started_at": None,
    "finished_at": None,
    "error": None,
    "local_path": None,
}

def register_setup_wizard(app, models_dir: Path) -> None:
    # store as string to avoid Path serialization surprises
    app.state.models_dir = str(models_dir)
    app.include_router(router)

def _models_dir(request: Request) -> Path:
    p = Path(request.app.state.models_dir)
    p.mkdir(parents=True, exist_ok=True)
    return p

def _list_models(models_dir: Path) -> List[str]:
    return sorted([p.name for p in models_dir.glob("*.gguf") if p.is_file()])

class DownloadTutorialModelRequest(BaseModel):
    repo_id: str = Field(default=DEFAULT_TUTORIAL_REPO)
    filename: str = Field(default=DEFAULT_TUTORIAL_FILE)

@router.get("/status")
def setup_status(request: Request):
    models_dir = _models_dir(request)
    models = _list_models(models_dir)

    setup_completed = (database.get_app_setting("setup_completed") == "true")
    tutorial_present = (models_dir / DEFAULT_TUTORIAL_FILE).exists()

    return {
        "models_dir": str(models_dir),
        "has_any_model": len(models) > 0,
        "models": models,
        "setup_completed": setup_completed,
        "tutorial_model": {
            "repo_id": DEFAULT_TUTORIAL_REPO,
            "filename": DEFAULT_TUTORIAL_FILE,
            "present": tutorial_present,
        },
        "download": _download_state,
    }

@router.post("/complete")
def setup_complete():
    database.set_app_setting("setup_completed", "true")
    return {"ok": True}

@router.post("/skip")
def setup_skip():
    database.set_app_setting("setup_completed", "true")
    return {"ok": True}

@router.post("/open-models-dir")
def open_models_dir(request: Request):
    models_dir = _models_dir(request)
    try:
        if sys.platform.startswith("win"):
            os.startfile(str(models_dir))  # type: ignore[attr-defined]
        elif sys.platform == "darwin":
            subprocess.Popen(["open", str(models_dir)])
        else:
            subprocess.Popen(["xdg-open", str(models_dir)])
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to open folder: {e}")
    return {"ok": True, "models_dir": str(models_dir)}

@router.post("/download-tutorial-model")
def download_tutorial_model(req: DownloadTutorialModelRequest, request: Request):
    global _download_thread
    models_dir = _models_dir(request)

    with _download_lock:
        if _download_state["status"] == "downloading":
            return {"ok": True, "download": _download_state}

        _download_state.update(
            {
                "status": "downloading",
                "repo_id": req.repo_id,
                "filename": req.filename,
                "started_at": datetime.now(timezone.utc).isoformat(),
                "finished_at": None,
                "error": None,
                "local_path": None,
            }
        )

        def _job():
            try:
                # This downloads via HF and also validates the file by loading it briefly.
                # Requires huggingface-hub (as documented by llama-cpp-python).
                llm = Llama.from_pretrained(
                    repo_id=req.repo_id,
                    filename=req.filename,
                    local_dir=str(models_dir),
                    local_dir_use_symlinks=False,
                    n_ctx=64,
                    n_gpu_layers=0,
                    verbose=False,
                )
                del llm
                gc.collect()

                local_path = models_dir / Path(req.filename).name
                _download_state.update(
                    {
                        "status": "done",
                        "finished_at": datetime.now(timezone.utc).isoformat(),
                        "local_path": str(local_path),
                    }
                )

                database.set_app_setting("setup_completed", "true")
                if database.get_app_setting("default_model_name") is None:
                    database.set_app_setting("default_model_name", Path(req.filename).name)

            except Exception as e:
                _download_state.update(
                    {
                        "status": "error",
                        "finished_at": datetime.now(timezone.utc).isoformat(),
                        "error": str(e),
                    }
                )

        _download_thread = threading.Thread(target=_job, daemon=True)
        _download_thread.start()

    return {"ok": True, "download": _download_state}
