# app/tools.py
import os
import httpx
from dotenv import load_dotenv
from pathlib import Path
from typing import List, Dict, Any, Optional

# ------------------------------
# Load Secrets
# ------------------------------
# Priority order:
# 1. LOCALIS_DATA_DIR/secret.env if LOCALIS_DATA_DIR is set and file exists
# 2. Fallback to repo root secret.env
def _load_secrets():
    """Load secrets from the appropriate location based on environment."""
    data_dir_env = os.getenv("LOCALIS_DATA_DIR")
    if data_dir_env:
        data_dir_path = Path(data_dir_env) / "secret.env"
        if data_dir_path.exists():
            load_dotenv(dotenv_path=data_dir_path)
            return

    # Fallback: repo root secret.env
    base_dir = Path(__file__).resolve().parent.parent
    load_dotenv(dotenv_path=base_dir / "secret.env")

_load_secrets()

# Note: We rely on os.getenv() inside functions to ensure fresh values
# if the environment changes at runtime, rather than caching module-level constants.

# ------------------------------
# Search Logic
# ------------------------------

async def web_search(
    query: str,
    provider: Optional[str] = None,
    custom_endpoint: Optional[str] = None,
    custom_api_key: Optional[str] = None
) -> str:
    """
    Performs a real-time web search using Brave, Tavily, or a custom provider.
    Returns a formatted string of results or an error code.

    provider: "auto" (default), "brave", "tavily", "custom"
    """
    results = []

    # Normalize provider
    mode = (provider or "auto").lower().strip()

    # --- Custom Provider ---
    if mode == "custom":
        if not custom_endpoint:
            return "ERROR_CUSTOM_ENDPOINT_MISSING"

        try:
            print(f" [Tools] Searching Custom Provider for: {query}")
            async with httpx.AsyncClient(timeout=10.0) as client:
                params = {"q": query}
                # Attach custom key if provided
                if custom_api_key:
                    params["api_key"] = custom_api_key

                # GET request by default
                r = await client.get(custom_endpoint, params=params)

                if r.status_code == 200:
                    try:
                        data = r.json()
                        # Expected Shape: { "results": [ { "title": "...", "snippet": "...", "url": "..." } ] }
                        res_list = data.get("results")
                        if not isinstance(res_list, list):
                            return "ERROR_CUSTOM_BAD_FORMAT"

                        for item in res_list:
                            title = item.get("title", "No Title")
                            snippet = item.get("snippet", "")
                            url = item.get("url", "")
                            results.append(f"[Custom] {title}: {snippet} ({url})")

                        if results:
                            return "\n".join(results)
                        return "ERROR_NO_RESULTS"
                    except Exception:
                        return "ERROR_CUSTOM_BAD_FORMAT"
                else:
                    return f"ERROR_CUSTOM_{r.status_code}"
        except Exception as e:
            return f"ERROR_CUSTOM_CONNECTION: {e}"

    # --- Brave Search ---
    # Determine key: override if mode is explicit 'brave', else use env
    brave_key = custom_api_key if (mode == "brave" and custom_api_key) else os.getenv("BRAVE_API_KEY")

    # Run if mode is 'brave' OR mode is 'auto'
    if mode in ["brave", "auto"] and brave_key:
        try:
            print(f" [Tools] Searching Brave for: {query}")
            async with httpx.AsyncClient(timeout=10.0) as client:
                headers = {"X-Subscription-Token": brave_key, "Accept": "application/json"}
                r = await client.get(
                    "https://api.search.brave.com/res/v1/web/search",
                    headers=headers,
                    params={"q": query, "count": 3}
                )

                if r.status_code == 200:
                    data = r.json()
                    # Brave returns results in 'web.results'
                    for item in data.get("web", {}).get("results", []):
                        title = item.get('title', 'No Title')
                        desc = item.get('description', '')
                        results.append(f"[Brave] {title}: {desc}")

                    # If we found results in explicit 'brave' mode or 'auto' mode, we are done
                    if results: return "\n".join(results)
        except Exception as e:
            print(f" [Brave Error] {e}")

    # --- Tavily Search ---
    # Determine key: override if mode is explicit 'tavily', else use env
    tavily_key = custom_api_key if (mode == "tavily" and custom_api_key) else os.getenv("TAVILY_API_KEY")

    # Run if mode is 'tavily' OR (mode is 'auto' AND no results yet)
    if (mode == "tavily" or (mode == "auto" and not results)) and tavily_key:
        try:
            print(f" [Tools] Searching Tavily for: {query}")
            async with httpx.AsyncClient(timeout=10.0) as client:
                r = await client.post(
                    "https://api.tavily.com/search",
                    json={"api_key": tavily_key, "query": query, "max_results": 3}
                )

                if r.status_code == 200:
                    data = r.json()
                    for item in data.get("results", []):
                        title = item.get('title', 'No Title')
                        content = item.get('content', '')
                        results.append(f"[Tavily] {title}: {content}")

                    if results: return "\n".join(results)
        except Exception as e:
            print(f" [Tavily Error] {e}")

    return "ERROR_NO_RESULTS"


# ------------------------------
# Tool Definitions & Wrappers
# ------------------------------

async def tool_web_search(
    query: str,
    provider: Optional[str] = None,
    custom_endpoint: Optional[str] = None,
    custom_api_key: Optional[str] = None
) -> str:
    """
    Wrapper for web_search to be used as a tool by the LLM.
    """
    return await web_search(query, provider, custom_endpoint, custom_api_key)


def get_tool_definitions() -> List[Dict[str, Any]]:
    """
    Returns the schema definition for the web.search tool.
    Compatible with OpenAI/Llama-cpp tool calling formats.
    """
    return [
        {
            "type": "function",
            "function": {
                "name": "web.search",
                "description": "Search the web for real-time information, news, or facts.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "The search query keywords."
                        }
                    },
                    "required": ["query"]
                }
            }
        }
    ]
