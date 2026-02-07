# app/updater.py
from __future__ import annotations

import os
import subprocess
from pathlib import Path
from typing import Any, Dict, Optional
from datetime import datetime, timezone

from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/update", tags=["update"])

# Cache for git executable path
_GIT_EXE: Optional[str] = None


def _get_git_exe() -> str:
    """
    Returns the git executable path from LOCALIS_GIT_EXE environment variable.
    Falls back to 'git' if not set or if the specified path doesn't exist.
    Caches the result for performance.
    """
    global _GIT_EXE

    if _GIT_EXE is None:
        git_path = os.environ.get('LOCALIS_GIT_EXE', 'git')

        # Validate absolute paths - if specified path doesn't exist, fall back to 'git'
        if git_path != 'git' and not Path(git_path).exists():
            print(f"[UPDATER] Warning: LOCALIS_GIT_EXE points to non-existent path: {git_path}")
            print("[UPDATER] Falling back to system 'git'")
            _GIT_EXE = 'git'
        else:
            _GIT_EXE = git_path
            if git_path != 'git':
                print(f"[UPDATER] Using bundled git: {git_path}")

    return _GIT_EXE


def register_updater(app, project_root: Path) -> None:
    app.state.project_root = str(project_root)
    app.include_router(router)


def _root(request: Request) -> Path:
    return Path(request.app.state.project_root)


def _git_available() -> bool:
    """
    Checks if git is available by running 'git --version'.
    Uses the git executable specified by LOCALIS_GIT_EXE if set.
    """
    try:
        git_exe = _get_git_exe()
        subprocess.run([git_exe, "--version"], capture_output=True, text=True, check=True)
        return True
    except Exception as e:
        print(f"[UPDATER] Git not available: {e}")
        return False


def _run_git(root: Path, args: list[str]) -> subprocess.CompletedProcess:
    """
    Runs a git command in the specified directory.
    Uses the git executable specified by LOCALIS_GIT_EXE if set.
    """
    git_exe = _get_git_exe()
    return subprocess.run([git_exe] + args, cwd=str(root), capture_output=True, text=True)


@router.get("/status")
def update_status(request: Request) -> Dict[str, Any]:
    """
    Returns the current git repository status including branch, commits ahead/behind,
    and whether the working tree is dirty.
    """
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
    """
    Applies pending git updates by pulling from the upstream branch.
    Requires a clean working tree and uses fast-forward-only merge by default.
    """
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
