# app/updater.py
from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any, Dict, Optional
from datetime import datetime, timezone

from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/update", tags=["update"])

def register_updater(app, project_root: Path) -> None:
    app.state.project_root = str(project_root)
    app.include_router(router)

def _root(request: Request) -> Path:
    return Path(request.app.state.project_root)

def _git_available() -> bool:
    try:
        subprocess.run(["git", "--version"], capture_output=True, text=True, check=True)
        return True
    except Exception:
        return False

def _run_git(root: Path, args: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(["git"] + args, cwd=str(root), capture_output=True, text=True)

@router.get("/status")
def update_status(request: Request) -> Dict[str, Any]:
    root = _root(request)

    if not _git_available():
        return {"supported": False, "reason": "git_not_found"}

    if not (root / ".git").exists():
        return {"supported": False, "reason": "not_a_git_clone"}

    fetch = _run_git(root, ["fetch", "--prune"])
    if fetch.returncode != 0:
        return {"supported": False, "reason": "git_fetch_failed", "stderr": fetch.stderr.strip()}

    branch = _run_git(root, ["rev-parse", "--abbrev-ref", "HEAD"])
    head = _run_git(root, ["rev-parse", "HEAD"])
    dirty = _run_git(root, ["status", "--porcelain"])

    up = _run_git(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])
    upstream: Optional[str] = up.stdout.strip() if up.returncode == 0 else None

    behind = ahead = None
    remote_head = None
    if upstream:
        remote = _run_git(root, ["rev-parse", upstream])
        if remote.returncode == 0:
            remote_head = remote.stdout.strip()

        b = _run_git(root, ["rev-list", "--count", f"HEAD..{upstream}"])
        a = _run_git(root, ["rev-list", "--count", f"{upstream}..HEAD"])
        if b.returncode == 0 and b.stdout.strip().isdigit():
            behind = int(b.stdout.strip())
        if a.returncode == 0 and a.stdout.strip().isdigit():
            ahead = int(a.stdout.strip())

    return {
        "supported": True,
        "root": str(root),
        "branch": branch.stdout.strip() if branch.returncode == 0 else None,
        "local_head": head.stdout.strip() if head.returncode == 0 else None,
        "upstream": upstream,
        "remote_head": remote_head,
        "behind": behind,
        "ahead": ahead,
        "dirty": bool(dirty.stdout.strip()),
        "checked_at": datetime.now(timezone.utc).isoformat(),
    }

class ApplyUpdateRequest(BaseModel):
    ff_only: bool = Field(default=True)

@router.post("/apply")
def apply_update(req: ApplyUpdateRequest, request: Request) -> Dict[str, Any]:
    root = _root(request)

    if not _git_available():
        raise HTTPException(status_code=400, detail="git_not_found")
    if not (root / ".git").exists():
        raise HTTPException(status_code=400, detail="not_a_git_clone")

    dirty = _run_git(root, ["status", "--porcelain"])
    if dirty.stdout.strip():
        raise HTTPException(status_code=409, detail="working_tree_dirty")

    fetch = _run_git(root, ["fetch", "--prune"])
    if fetch.returncode != 0:
        raise HTTPException(status_code=500, detail=f"git_fetch_failed: {fetch.stderr.strip()}")

    pull_args = ["pull"]
    if req.ff_only:
        pull_args += ["--ff-only"]

    pull = _run_git(root, pull_args)
    if pull.returncode != 0:
        raise HTTPException(status_code=500, detail=f"git_pull_failed: {pull.stderr.strip()}")

    return {"ok": True, "stdout": pull.stdout, "stderr": pull.stderr, "restart_required": True}
