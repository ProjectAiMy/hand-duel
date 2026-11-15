"""Dev server for Hand Duel. Usage: python3 serve.py [port]

- http://localhost:PORT for this computer (no caching, so edits show up on a normal reload).
- https://<this computer's wifi IP>:PORT+443 for phones and other computers on the same wifi.
  Browsers only allow the camera on HTTPS, so this uses a self-signed certificate made with
  openssl (kept in .cert/). Each device shows a one-time "not private" warning: tap
  Advanced / Show Details, then Proceed / Visit website.
"""
import http.server
import json
import socket
import socketserver
import ssl
import subprocess
import sys
import threading
from pathlib import Path

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
HTTPS_PORT = PORT + 443  # 8000 -> 8443
ROOT = Path(__file__).resolve().parent
CERT_DIR = ROOT / ".cert"


def lan_ip():
    """This computer's address on the local network (no packets are sent)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]
    except OSError:
        return None
    finally:
        s.close()


IP = lan_ip()
LAN_URL = f"https://{IP}:{HTTPS_PORT}/" if IP else None


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        # Lets the game build invite links other devices can open (localhost won't work for them).
        if self.path == "/lan.json":
            body = json.dumps({"url": LAN_URL if HTTPS_ENABLED else None}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path.startswith("/.cert"):
            self.send_error(404)
            return
        super().do_GET()

    def log_message(self, fmt, *args):
        if args and str(args[1]) != "200" and "favicon" not in str(args[0]):
            super().log_message(fmt, *args)


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def ensure_cert():
    """Self-signed cert for localhost and the current wifi IP; remade if the IP changes."""
    CERT_DIR.mkdir(exist_ok=True)
    cert, key, stamp = CERT_DIR / "cert.pem", CERT_DIR / "key.pem", CERT_DIR / "ip.txt"
    if cert.exists() and key.exists() and stamp.exists() and stamp.read_text() == str(IP):
        return cert, key
    san = "DNS:localhost,IP:127.0.0.1" + (f",IP:{IP}" if IP else "")
    subprocess.run(
        ["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "825",
         "-keyout", str(key), "-out", str(cert), "-subj", "/CN=Hand Duel dev server",
         "-addext", f"subjectAltName={san}"],
        check=True, capture_output=True,
    )
    stamp.write_text(str(IP))
    return cert, key


def bind(port):
    try:
        return Server(("", port), NoCacheHandler)
    except OSError as e:
        if e.errno in (48, 98):  # address in use (macOS, Linux)
            sys.exit(
                f"Port {port} is already in use: a server may already be running, so try "
                f"http://localhost:{PORT}.\nOr start on another port: python3 serve.py {PORT + 1}"
            )
        raise


HTTPS_ENABLED = False

if __name__ == "__main__":
    httpd = bind(PORT)
    httpsd = None
    try:
        cert, key = ensure_cert()
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(cert, key)
        httpsd = bind(HTTPS_PORT)
        httpsd.socket = ctx.wrap_socket(httpsd.socket, server_side=True)
        HTTPS_ENABLED = True
        threading.Thread(target=httpsd.serve_forever, daemon=True).start()
    except (OSError, subprocess.CalledProcessError, FileNotFoundError) as e:
        print(f"(HTTPS for other devices is off: {e})")

    print(f"Hand Duel running at http://localhost:{PORT}  (Ctrl+C to stop)")
    if HTTPS_ENABLED and IP:
        print(f"Other devices on the same wifi: {LAN_URL}")
        print("  First visit shows a 'not private' warning: Advanced / Show Details -> Proceed / Visit website.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        httpd.server_close()
        if httpsd:
            httpsd.server_close()
