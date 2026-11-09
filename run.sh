#!/bin/sh
# Serve the app locally (Web Workers need http://, not file://) and open the browser.
cd "$(dirname "$0")"
(sleep 1; xdg-open http://localhost:8000 >/dev/null 2>&1) &
exec python3 -m http.server 8000 --bind 127.0.0.1
