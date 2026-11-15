"""Dev server for Hand Duel: like `python3 -m http.server`, but tells the browser not to cache,
so edits show up on a normal reload. Usage: python3 serve.py [port]"""
import http.server
import socketserver
import sys
from pathlib import Path

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
ROOT = Path(__file__).resolve().parent


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == "__main__":
    try:
        httpd = Server(("", PORT), NoCacheHandler)
    except OSError as e:
        if e.errno in (48, 98):  # address in use (macOS, Linux)
            sys.exit(
                f"Port {PORT} is already in use: a server may already be running, so try "
                f"http://localhost:{PORT}.\nOr start on another port: python3 serve.py {PORT + 1}"
            )
        raise
    with httpd:
        print(f"Hand Duel running at http://localhost:{PORT}  (Ctrl+C to stop)")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")
