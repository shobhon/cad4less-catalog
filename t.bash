# show models.py that Python is importing inside the container
docker compose run --rm web python - <<'PY'
import inspect, models
print(inspect.getsource(models))
PY

# show the first lines of app.py as seen by the container
docker compose run --rm web python - <<'PY'
import inspect, app
import textwrap
src = inspect.getsource(app)
print("\n".join(src.splitlines()[:30]))
PY