"""Local dev server for Glowgrove.

Same as `python3 -m http.server`, but tells the browser never to cache, so
code changes always show up after a reload.

Usage (from the glowgrove folder):  python3 tools/serve.py [port]
"""
import functools
import http.server
import os
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5173
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    handler = functools.partial(NoCacheHandler, directory=root)
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), handler) as httpd:
        print(f"Glowgrove running at http://127.0.0.1:{port}")
        httpd.serve_forever()
