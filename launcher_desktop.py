import threading
import time
import webbrowser
import uvicorn

from app.main import app

def main():
    config = uvicorn.Config(app, host="127.0.0.1", port=8000, log_level="info", access_log=False)
    server = uvicorn.Server(config)

    t = threading.Thread(target=server.run, daemon=True)
    t.start()

    time.sleep(0.8)
    webbrowser.open("http://127.0.0.1:8000")

    t.join()

if __name__ == "__main__":
    main()
