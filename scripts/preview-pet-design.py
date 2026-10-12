"""Serve only the companion design study and its public artwork on localhost."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, unquote
import argparse

root = Path(__file__).resolve().parent.parent
study = root / 'docs/design/pets/menu-variants/v1'
class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        route = unquote(urlsplit(path).path)
        aliases = {'/pets/fox/': root/'public/pets/fox', '/scenes/': root/'public/scenes', '/fonts/': root/'public/fonts', '/research/': root/'docs/design/pets'}
        if route == '/': return str(study/'index.html')
        for prefix, directory in aliases.items():
            if route.startswith(prefix):
                if prefix == '/research/' and route != '/research/qq-desktop-pet-research.md': break
                target = (directory/route[len(prefix):]).resolve()
                if target.is_relative_to(directory.resolve()): return str(target)
                break
        if route in ('/index.html', '/style.css', '/preview.js'): return str(study/route[1:])
        return str(study/'not-found')
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

if __name__ == '__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--port', type=int, default=1421);args=parser.parse_args()
    print(f'Companion design preview: http://127.0.0.1:{args.port}/', flush=True)
    ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()
