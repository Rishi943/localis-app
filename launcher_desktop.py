#!/usr/bin/env python3
"""
Localis Launcher for Windows
Manages runtime detection, git operations, and server lifecycle.

This launcher:
1. Detects bundled Python and Git (or system fallbacks)
2. Clones/updates the app repository
3. Launches the FastAPI server with proper environment
4. Opens browser to app URL
"""

import os
import sys
import json
import time
import logging
import subprocess
import webbrowser
from pathlib import Path
from typing import Optional, Tuple

# Logging will be configured in main() after install_root is determined
logger = logging.getLogger(__name__)


class LauncherError(Exception):
    """Base exception for launcher errors."""
    pass


def find_bundled_python(install_root: Path, bundle_root: Optional[Path] = None, is_frozen: bool = False) -> Optional[Path]:
    """
    Find bundled Python executable.

    Checks:
    1. Bundled runtime (install_root/runtime/python/python.exe)
    2. PyInstaller bundle (bundle_root/runtime/python/python.exe)
    3. System Python (only if not frozen)

    Args:
        install_root: Installation directory
        bundle_root: PyInstaller bundle directory (if running as exe)
        is_frozen: True if running as frozen executable

    Returns:
        Path to python.exe or None
    """
    candidates = []

    # 1. Bundled runtime in install directory
    if install_root:
        candidates.append(install_root / 'runtime' / 'python' / 'python.exe')

    # 2. Bundled runtime in PyInstaller _MEIPASS
    if bundle_root:
        candidates.append(bundle_root / 'runtime' / 'python' / 'python.exe')

    for path in candidates:
        if path.exists():
            logger.info(f"Found bundled Python: {path}")
            return path

    # 3. Fallback to system Python ONLY if running as script (not frozen)
    if not is_frozen:
        logger.warning("Bundled Python not found, using system Python")
        return Path(sys.executable)

    # If frozen and no bundled Python found, this is a fatal error
    logger.error("Bundled Python not found in frozen executable")
    return None


def find_bundled_git(install_root: Path, bundle_root: Optional[Path] = None) -> Optional[str]:
    """
    Find bundled Git executable.

    Checks:
    1. Bundled runtime (install_root/runtime/git/bin/git.exe)
    2. PyInstaller bundle (bundle_root/runtime/git/bin/git.exe)
    3. System Git (in PATH)

    Args:
        install_root: Installation directory
        bundle_root: PyInstaller bundle directory (if running as exe)

    Returns:
        Path to git.exe or 'git' (system fallback)
    """
    candidates = []

    # 1. Bundled runtime in install directory
    if install_root:
        candidates.append(install_root / 'runtime' / 'git' / 'bin' / 'git.exe')

    # 2. Bundled runtime in PyInstaller _MEIPASS
    if bundle_root:
        candidates.append(bundle_root / 'runtime' / 'git' / 'bin' / 'git.exe')

    for path in candidates:
        if path.exists():
            logger.info(f"Found bundled Git: {path}")
            return str(path)

    # 3. Check system PATH
    try:
        result = subprocess.run(
            ['git', '--version'],
            capture_output=True,
            text=True,
            timeout=5
        )
        if result.returncode == 0:
            logger.info("Using system Git from PATH")
            return 'git'
    except (subprocess.TimeoutExpired, FileNotFoundError):
        pass

    logger.warning("Git not found (bundled or system)")
    return None


def clone_or_update_repo(git_exe: str, app_dir: Path, repo_url: str, branch: str = 'main') -> bool:
    """
    Clone repository if missing, or pull updates if exists.

    Args:
        git_exe: Git executable path
        app_dir: Target directory for app repository
        repo_url: Git repository URL
        branch: Branch to checkout

    Returns:
        True if successful, False otherwise
    """
    try:
        if not app_dir.exists():
            logger.info(f"Cloning repository to {app_dir}...")
            logger.info(f"Repository: {repo_url}")

            # Clone repository
            result = subprocess.run(
                [git_exe, 'clone', '--depth=1', '--branch', branch, repo_url, str(app_dir)],
                capture_output=True,
                text=True,
                timeout=300
            )

            if result.returncode != 0:
                logger.error(f"Git clone failed: {result.stderr}")
                return False

            logger.info("Repository cloned successfully")
            return True

        else:
            logger.info(f"Updating existing repository at {app_dir}...")

            # Check if directory is a git repository
            git_dir = app_dir / '.git'
            if not git_dir.exists():
                logger.warning(f"{app_dir} exists but is not a git repository")
                return False

            # Robust update sequence: fetch --prune, checkout branch, pull --ff-only
            # 1. Fetch with prune to clean up stale references
            result = subprocess.run(
                [git_exe, '-C', str(app_dir), 'fetch', '--prune'],
                capture_output=True,
                text=True,
                timeout=60
            )

            if result.returncode != 0:
                logger.error(f"Git fetch failed: {result.stderr}")
                return False

            # 2. Checkout the target branch
            result = subprocess.run(
                [git_exe, '-C', str(app_dir), 'checkout', branch],
                capture_output=True,
                text=True,
                timeout=30
            )

            if result.returncode != 0:
                logger.error(f"Git checkout failed: {result.stderr}")
                return False

            # 3. Pull with fast-forward only (safer, prevents merge conflicts)
            result = subprocess.run(
                [git_exe, '-C', str(app_dir), 'pull', '--ff-only'],
                capture_output=True,
                text=True,
                timeout=60
            )

            if result.returncode != 0:
                logger.error(f"Git pull failed: {result.stderr}")
                return False

            logger.info("Repository updated successfully")
            return True

    except subprocess.TimeoutExpired:
        logger.error("Git operation timed out")
        return False
    except Exception as e:
        logger.error(f"Git operation failed: {e}")
        return False


def install_dependencies(python_exe: Path, app_dir: Path) -> bool:
    """
    Install Python dependencies from requirements.txt.

    Args:
        python_exe: Python executable path
        app_dir: App directory containing requirements.txt

    Returns:
        True if successful, False otherwise
    """
    requirements_file = app_dir / 'requirements.txt'

    if not requirements_file.exists():
        logger.warning(f"requirements.txt not found at {requirements_file}")
        return True  # Not fatal, app might work without deps

    logger.info("Installing dependencies...")

    try:
        result = subprocess.run(
            [
                str(python_exe), '-m', 'pip', 'install', '-r', str(requirements_file),
                '--quiet', '--disable-pip-version-check'
            ],
            capture_output=True,
            text=True,
            timeout=300
        )

        if result.returncode != 0:
            logger.error(f"Dependency installation failed: {result.stderr}")
            return False

        logger.info("Dependencies installed successfully")
        return True

    except subprocess.TimeoutExpired:
        logger.error("Dependency installation timed out")
        return False
    except Exception as e:
        logger.error(f"Dependency installation failed: {e}")
        return False


def find_available_port(start: int = 8000, max_attempts: int = 10) -> int:
    """
    Find an available port starting from 'start'.

    Args:
        start: Starting port number
        max_attempts: Maximum ports to try

    Returns:
        Available port number

    Raises:
        LauncherError: If no available port found
    """
    import socket

    for port in range(start, start + max_attempts):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
                sock.bind(('127.0.0.1', port))
                return port
        except OSError:
            continue

    raise LauncherError(f"No available ports in range {start}-{start + max_attempts}")


def launch_server(
    python_exe: Path,
    install_root: Path,
    app_dir: Path,
    host: str,
    port: int,
    git_exe: Optional[str]
) -> subprocess.Popen:
    """
    Launch the FastAPI server with proper environment.

    Args:
        python_exe: Python executable path
        install_root: Installation root directory
        app_dir: App directory
        host: Server host
        port: Server port
        git_exe: Git executable path (for /update endpoints)

    Returns:
        Popen object for server process
    """
    env = os.environ.copy()

    # Set app-specific environment variables
    env['MODEL_PATH'] = str(install_root / 'models')
    env['LOCALIS_DATA_DIR'] = str(install_root / 'data')

    # Prepend app_dir to PYTHONPATH for proper module resolution
    existing_pythonpath = env.get('PYTHONPATH', '')
    if existing_pythonpath:
        env['PYTHONPATH'] = str(app_dir) + os.pathsep + existing_pythonpath
    else:
        env['PYTHONPATH'] = str(app_dir)

    # Pass bundled git to server process for /update endpoints
    if git_exe and git_exe != 'git':
        # Absolute path to bundled git
        env['LOCALIS_GIT_EXE'] = git_exe

        # Add git bin directory to PATH for subprocess calls
        git_bin = str(Path(git_exe).parent)
        env['PATH'] = git_bin + os.pathsep + env.get('PATH', '')

        logger.info(f"Setting LOCALIS_GIT_EXE={git_exe}")
        logger.info(f"Adding to PATH: {git_bin}")
    else:
        # System git or not found
        env['LOCALIS_GIT_EXE'] = git_exe or 'git'

    # Launch uvicorn server
    cmd = [
        str(python_exe), '-m', 'uvicorn',
        'app.main:app',
        '--host', host,
        '--port', str(port),
        '--app-dir', str(app_dir)
    ]

    logger.info(f"App directory (repo root): {app_dir}")
    logger.info(f"Full uvicorn command: {cmd}")

    # Redirect stdout/stderr to log file to avoid deadlocks
    server_log_path = install_root / 'logs' / 'localis_server.log'
    server_log_file = open(server_log_path, 'a', encoding='utf-8')
    logger.info(f"Server output will be logged to: {server_log_path}")

    process = subprocess.Popen(
        cmd,
        env=env,
        cwd=str(app_dir),
        stdout=server_log_file,
        stderr=subprocess.STDOUT,  # Merge stderr into stdout
        text=True
    )

    return process


def wait_for_server(host: str, port: int, timeout: int = 30) -> bool:
    """
    Wait for server to become available.

    Args:
        host: Server host
        port: Server port
        timeout: Maximum wait time in seconds

    Returns:
        True if server is ready, False if timeout
    """
    import socket
    import time

    start_time = time.time()

    while time.time() - start_time < timeout:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
                sock.settimeout(1)
                sock.connect((host, port))
                logger.info("Server is ready")
                return True
        except (socket.error, socket.timeout):
            time.sleep(0.5)

    logger.error(f"Server failed to start within {timeout} seconds")
    return False


def open_browser(host: str, port: int, delay: float = 1.0):
    """
    Open URL in default browser after delay.

    If host is 0.0.0.0, converts to 127.0.0.1 for browser access.

    Args:
        host: Server host
        port: Server port
        delay: Delay in seconds before opening
    """
    time.sleep(delay)

    # Convert 0.0.0.0 to 127.0.0.1 for browser
    browser_host = '127.0.0.1' if host == '0.0.0.0' else host
    url = f"http://{browser_host}:{port}"

    logger.info(f"Opening browser: {url}")
    try:
        webbrowser.open(url)
    except Exception as e:
        logger.error(f"Failed to open browser: {e}")


def load_config(config_path: Path) -> dict:
    """
    Load configuration from JSON file.

    Args:
        config_path: Path to config JSON

    Returns:
        Configuration dictionary
    """
    if not config_path.exists():
        logger.warning(f"Config file not found: {config_path}")
        return {}

    try:
        with open(config_path, 'r') as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"Failed to load config: {e}")
        return {}


def main():
    """Main launcher entry point."""
    try:
        # Detect installation directory
        is_frozen = getattr(sys, 'frozen', False)
        if is_frozen:
            # Running as PyInstaller executable
            bundle_root = Path(sys._MEIPASS)
            install_root = Path(sys.executable).parent
        else:
            # Running as script
            bundle_root = None
            install_root = Path(__file__).parent

        # Environment variable override for install root (highest priority)
        if env_install_root := os.getenv('LOCALIS_INSTALL_ROOT'):
            install_root = Path(env_install_root)

        # Create logs directory and configure logging
        logs_dir = install_root / 'logs'
        logs_dir.mkdir(exist_ok=True)

        log_file = logs_dir / 'localis_launcher.log'
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s - %(levelname)s - %(message)s',
            handlers=[
                logging.StreamHandler(sys.stdout),
                logging.FileHandler(log_file, encoding='utf-8')
            ]
        )

        logger.info("=== Localis Launcher Starting ===")
        logger.info(f"Install root: {install_root}")
        logger.info(f"Bundle root: {bundle_root}")
        logger.info(f"Frozen executable: {is_frozen}")

        # Load configuration from file
        config_path = install_root / 'localis_runtime_config.json'
        config = load_config(config_path)

        # Configuration priority: env vars > config file > defaults
        # Prefer app_repo_url/app_branch, fall back to repo_url/branch for backward compat
        repo_url = os.getenv('LOCALIS_APP_REPO_URL') or \
                   config.get('app_repo_url') or \
                   config.get('repo_url', 'https://github.com/yourusername/localis-app.git')

        branch = os.getenv('LOCALIS_APP_BRANCH') or \
                 config.get('app_branch') or \
                 config.get('branch', 'main')

        host = os.getenv('LOCALIS_HOST') or config.get('host', '127.0.0.1')

        port_start = int(os.getenv('LOCALIS_PORT', 0)) or config.get('port', 8000)

        logger.info(f"Configuration: repo={repo_url}, branch={branch}, host={host}, port={port_start}")

        # Find bundled Python
        python_exe = find_bundled_python(install_root, bundle_root, is_frozen)
        if not python_exe:
            raise LauncherError(
                "Python runtime not found. "
                "Expected bundled Python at runtime/python/python.exe. "
                "Cannot fall back to system Python in frozen executable."
            )

        logger.info(f"Using Python: {python_exe}")

        # Find bundled Git
        git_exe = find_bundled_git(install_root, bundle_root)

        # Setup directories
        app_dir = install_root / 'app'
        models_dir = install_root / 'models'
        data_dir = install_root / 'data'

        models_dir.mkdir(exist_ok=True)
        data_dir.mkdir(exist_ok=True)

        # Git rules: if git missing and app/ does not exist, this is fatal
        if not git_exe and not app_dir.exists():
            raise LauncherError(
                "Git not found and app directory does not exist. "
                "Cannot clone repository on first run. "
                "Please ensure Git is bundled or app/ is pre-installed."
            )

        # Clone or update repository
        if git_exe:
            success = clone_or_update_repo(git_exe, app_dir, repo_url, branch)
            if not success:
                logger.error("Failed to clone/update repository")
                if not app_dir.exists():
                    raise LauncherError("Repository unavailable and no local copy exists")
                else:
                    logger.warning("Continuing with existing app directory")
        else:
            logger.warning("Git not found - skipping repository updates")

        # Install dependencies
        if not install_dependencies(python_exe, app_dir):
            logger.warning("Dependency installation failed, attempting to continue...")

        # Find available port
        try:
            port = find_available_port(port_start)
            logger.info(f"Using port: {port}")
        except LauncherError:
            logger.error(f"Port {port_start} and alternatives are in use")
            raise

        # Launch server
        server_process = launch_server(python_exe, install_root, app_dir, host, port, git_exe)

        # Wait for server to be ready (check against actual bind address)
        # For 0.0.0.0, we can check 127.0.0.1
        check_host = '127.0.0.1' if host == '0.0.0.0' else host
        if not wait_for_server(check_host, port, timeout=30):
            server_process.terminate()
            raise LauncherError("Server failed to start")

        # Open browser (handles 0.0.0.0 → 127.0.0.1 conversion)
        open_browser(host, port, delay=1.0)

        browser_host = '127.0.0.1' if host == '0.0.0.0' else host
        logger.info("Localis is running")
        logger.info(f"Access at: http://{browser_host}:{port}")
        logger.info("Press Ctrl+C to stop")

        # Keep launcher alive while server runs
        try:
            server_process.wait()
        except KeyboardInterrupt:
            logger.info("Shutting down...")
            server_process.terminate()
            server_process.wait(timeout=10)

        logger.info("Localis stopped")

    except LauncherError as e:
        logger.error(f"Launcher error: {e}")
        input("Press Enter to exit...")
        sys.exit(1)
    except Exception as e:
        logger.error(f"Unexpected error: {e}", exc_info=True)
        input("Press Enter to exit...")
        sys.exit(1)


if __name__ == '__main__':
    main()
