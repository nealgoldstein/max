#!/usr/bin/env python3
# dev-server.py — the Max preview server, with caching DISABLED.
#
# Plain `python3 -m http.server` sends no Cache-Control, so browsers
# heuristically cache our constant `?v=DEV` asset URLs and keep serving
# STALE JavaScript across normal reloads — the recurring "I think I'm still
# running stale code" problem. This server fixes that TWO ways:
#
#   1. Every response is stamped `Cache-Control: no-store` (no heuristic cache).
#   2. CRITICAL: when serving an .html page, the constant `?v=DEV` on every
#      <script>/<link> is rewritten to `?v=<millis>` — a fresh value on EVERY
#      load. Because the asset URL itself changes, the browser cannot reuse a
#      cached module (or a bfcache subresource), so a plain reload ALWAYS pulls
#      fresh JS for every file, not just index.html. This is what ends the
#      "the banner updated but the behavior didn't" class of confusion: index
#      and modules now move together.
#
# Usage: python3 dev-server.py <port> <directory>
import http.server
import socketserver
import sys
import os
import time

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
DIRECTORY = sys.argv[2] if len(sys.argv) > 2 else "."


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def do_GET(self):
        # Resolve the request to a file; serve index.html for a directory.
        p = self.translate_path(self.path.split("?", 1)[0])
        if os.path.isdir(p):
            idx = os.path.join(p, "index.html")
            if os.path.exists(idx):
                p = idx
        # For HTML, bust the constant dev asset version so EVERY module refetches.
        if p.endswith(".html") and os.path.exists(p):
            try:
                with open(p, "rb") as f:
                    body = f.read()
                stamp = str(int(time.time() * 1000)).encode()
                body = body.replace(b"v=DEV", b"v=" + stamp)
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            except Exception:
                pass  # fall back to the default file handler
        return super().do_GET()


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    with Server(("", PORT), NoCacheHandler) as httpd:
        print("→ no-cache dev server on http://localhost:%d  (serving %s)" % (PORT, DIRECTORY))
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
