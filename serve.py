"""Run Taskdesk locally:  python serve.py   then open http://127.0.0.1:8765

Like the live site, any address that isn't a real file (e.g. /board, /task/abc) serves index.html.
"""
import http.server
import pathlib
import sys

ROOT = pathlib.Path(__file__).parent.resolve()
PUBLIC = {"index.html", "config.js", "backend.js", "google.js"}


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(ROOT), **k)

    def translate_path(self, path):
        name = path.split("?", 1)[0].split("#", 1)[0].strip("/")
        return str(ROOT / (name if name in PUBLIC else "index.html"))


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    print(f"Taskdesk running at http://127.0.0.1:{port}")
    http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
