# wsgi.py  (at repo root)
# Try to import a global `app` first; fall back to a factory `create_app()`.
app = None

try:
    from app import app as _app  # if your app.py defines: app = Flask(__name__)
    app = _app
except Exception:
    pass

if app is None:
    # If using factory pattern in app.py:
    from app import create_app  # must exist if you don’t expose a global `app`
    app = create_app()