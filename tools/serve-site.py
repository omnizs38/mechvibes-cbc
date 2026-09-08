"""Local/CI preview with the same response security headers as Cloudflare Pages."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

root = Path(__file__).resolve().parent.parent / 'public'
headers = {}
for line in (root / '_headers').read_text().splitlines():
    if line.startswith('  ') and ':' in line:
        key, value = line.strip().split(':', 1)
        headers[key] = value.strip()

class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        for key, value in headers.items():
            self.send_header(key, value)
        super().end_headers()

if __name__ == '__main__':
    ThreadingHTTPServer(('127.0.0.1', 4173), partial(Handler, directory=str(root))).serve_forever()
