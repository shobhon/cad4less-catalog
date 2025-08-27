# app.py
import os, io, csv
from datetime import datetime
from flask import (
    Flask, render_template, render_template_string, request,
    redirect, url_for, flash, jsonify, Response
)
from werkzeug.utils import secure_filename

# IMPORTANT: import the ONE TRUE db from models, together with your models.
# This must match where `db = SQLAlchemy()` is actually defined.
from models import db, Category, Part, Build, BuildPart

ALLOWED_IMPORT_EXTS = {"csv"}

def create_app():
    app = Flask(__name__, instance_relative_config=True)

    # --- Config ---
    app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev")
    os.makedirs(app.instance_path, exist_ok=True)
    default_db_uri = f"sqlite:///{os.path.join(app.instance_path, 'catalog.db')}"
    app.config["SQLALCHEMY_DATABASE_URI"] = (
        os.environ.get("CATALOG_SQLALCHEMY_DATABASE_URI")
        or os.environ.get("SQLALCHEMY_DATABASE_URI")
        or os.environ.get("DATABASE_URL")
        or default_db_uri
    )
    app.config.setdefault("SQLALCHEMY_TRACK_MODIFICATIONS", False)

    # --- DB init: call init_app on the SAME db instance your models use ---
    db.init_app(app)
    with app.app_context():
        # Prefer migrations if present; else create tables
        try:
            from flask_migrate import upgrade
            upgrade()
        except Exception:
            db.create_all()

    # ---------- Routes ----------

    @app.get("/health")
    def health():
        return {"ok": True, "time": datetime.utcnow().isoformat()}

    @app.get("/__routes")
    def __routes():
        lines = []
        for r in app.url_map.iter_rules():
            lines.append(f"{','.join(sorted(r.methods))}  {r.rule}  -> {r.endpoint}")
        return Response("<pre>" + "\n".join(sorted(lines)) + "</pre>", mimetype="text/html")

    @app.get("/")
    def home():
        return redirect(url_for("list_builds"))

    # ----- Builds -----

    @app.get("/builds")
    def list_builds():
        builds = Build.query.order_by(Build.id.desc()).all()
        # If you already have a template, use it; else fallback.
        try:
            return render_template("builds_list.html", builds=builds)
        except Exception:
            rows = []
            for b in builds:
                total = 0.0
                for bp in b.build_parts:
                    unit = bp.part.price or 0.0
                    qty = bp.quantity or 1
                    total += unit * qty
                rows.append(f"<li>{b.name} — ${total:.2f}</li>")
            html = "<h2>Builds</h2><ul>" + "".join(rows) + "</ul>"
            html += f'<p><a href="{url_for("new_build_form")}" class="btn">New Build</a></p>'
            return render_template_string(html)

    @app.get("/builds/new")
    def new_build_form():
        categories = Category.query.order_by(Category.name).all()
        parts_by_cat = {
            c.id: Part.query.filter_by(category_id=c.id).order_by(Part.name).all()
            for c in categories
        }
        try:
            return render_template("new_build.html", categories=categories, parts_by_cat=parts_by_cat)
        except Exception:
            html = """
            <h2>New Build</h2>
            <form method="post" action="{{ url_for('create_build') }}">
              <label>Build name</label>
              <input name="name" required>
              <button class="btn" type="submit">Create</button>
            </form>
            """
            return render_template_string(html)

    @app.post("/builds")
    def create_build():
        name = (request.form.get("name") or "").strip()
        if not name:
            flash("Build name is required.", "error")
            return redirect(url_for("new_build_form"))

        build = Build(name=name, created_at=datetime.utcnow())
        db.session.add(build)
        db.session.flush()

        for k, v in request.form.items():
            if not k.startswith("part_"):
                continue
            try:
                part_id = int(k.split("_", 1)[1])
            except Exception:
                continue
            qty = 1
            if v and str(v).strip().isdigit():
                qty = max(1, int(v))
            part = Part.query.get(part_id)
            if part:
                db.session.add(BuildPart(build_id=build.id, part_id=part.id, quantity=qty))

        db.session.commit()
        flash("Build created.", "success")
        return redirect(url_for("list_builds"))

    # ----- Import CSV -----

    @app.route("/import", methods=["GET", "POST"])
    def import_catalog_route():
        if request.method == "GET":
            try:
                return render_template("import_form.html")
            except Exception:
                html = f"""
                <h2>Import CSV</h2>
                <form method="post" enctype="multipart/form-data" action="{url_for('import_catalog_route')}">
                  <input type="file" name="file" accept=".csv" required>
                  <button class="btn" type="submit">Upload</button>
                </form>
                """
                return render_template_string(html)

        f = request.files.get("file")
        if not f or not f.filename:
            flash("Please choose a CSV file.", "error")
            return redirect(url_for("import_catalog_route"))

        filename = secure_filename(f.filename)
        if "." not in filename or filename.rsplit(".", 1)[1].lower() not in {"csv"}:
            flash("Only .csv files are allowed.", "error")
            return redirect(url_for("import_catalog_route"))

        added, updated = import_csv_into_db(f.read())
        db.session.commit()
        flash(f"Import complete. Added {added}, updated {updated}.", "success")
        return redirect(url_for("list_products"))

    # stable alias some templates use
    app.add_url_rule("/import", endpoint="import_catalog", view_func=import_catalog_route, methods=["GET", "POST"])

    # ----- Products -----

    @app.get("/products")
    def list_products():
        # Minimal, template-free response to avoid Jinja issues while we fix db wiring.
        parts = Part.query.order_by(Part.name).all()
        rows = []
        for p in parts:
            cat = p.category.name if p.category else ""
            brand = getattr(p, "brand", "") or ""
            url = getattr(p, "url", "") or ""
            price = "" if p.price is None else f"${p.price:0.2f}"
            link = f'<a href="{url}" target="_blank" rel="noopener">Link</a>' if url else ""
            rows.append(f"<tr><td>{p.id}</td><td>{p.name}</td><td>{cat}</td><td>{brand}</td><td>{link}</td><td>{price}</td></tr>")
        table = (
            "<h2>Products</h2>"
            "<p><a href='/import'>Import CSV</a></p>"
            "<table border='1' cellpadding='6' cellspacing='0'>"
            "<thead><tr><th>ID</th><th>Name</th><th>Category</th><th>Brand</th><th>URL</th><th>Price</th></tr></thead>"
            f"<tbody>{''.join(rows) if rows else '<tr><td colspan=6><em>No products yet. Try Import CSV.</em></td></tr>'}</tbody>"
            "</table>"
        )
        return table

    @app.post("/products/<int:part_id>/delete")
    def delete_product(part_id: int):
        BuildPart.query.filter_by(part_id=part_id).delete()
        part = Part.query.get_or_404(part_id)
        db.session.delete(part)
        db.session.commit()
        flash("Product deleted.", "success")
        return redirect(url_for("list_products"))

    # alias for legacy templates
    app.add_url_rule("/builds/new", endpoint="new_build", view_func=new_build_form)

    return app


def _pick(row: dict, *candidates, default=None):
    lowered = {k.lower(): v for k, v in row.items()}
    for cand in candidates:
        v = lowered.get(cand.lower())
        if v is not None and str(v).strip() != "":
            return v
    return default


def _parse_price(val):
    if val is None:
        return None
    s = str(val).strip()
    if not s:
        return None
    s = s.replace(",", "")
    for ch in ("$", "£", "€", "৳", "Tk", "tk", "BDT"):
        s = s.replace(ch, "")
    try:
        return float(s)
    except Exception:
        return None


def import_csv_into_db(file_bytes: bytes):
    added, updated = 0, 0
    text = file_bytes.decode("utf-8-sig", errors="ignore")
    reader = csv.DictReader(io.StringIO(text))

    for row in reader:
        category_name = _pick(row, "Category", "Category Name", "Type", "Group")
        product_name  = _pick(row, "Product Name", "Name", "Part", "Item", "Title")
        brand         = _pick(row, "Brand", "Manufacturer", "Maker")
        url           = _pick(row, "URL", "Link", "Product URL")
        price_val     = _pick(row, "Price", "Cost", "Unit Price", "MSRP")
        price         = _parse_price(price_val)

        if not product_name:
            continue

        cat = None
        if category_name:
            cat = Category.query.filter_by(name=category_name.strip()).first()
            if not cat:
                cat = Category(name=category_name.strip())
                db.session.add(cat)
                db.session.flush()

        q = Part.query.filter_by(name=product_name.strip())
        if cat:
            q = q.filter_by(category_id=cat.id)
        part = q.first()

        if not part:
            part = Part(name=product_name.strip(), category=cat, price=price)
            if hasattr(part, "brand"): part.brand = brand
            if hasattr(part, "url"):   part.url = url
            db.session.add(part)
            added += 1
        else:
            changed = False
            if hasattr(part, "brand") and brand and part.brand != brand:
                part.brand = brand; changed = True
            if hasattr(part, "url") and url and part.url != url:
                part.url = url; changed = True
            if price is not None and part.price != price:
                part.price = price; changed = True
            if changed:
                updated += 1

    return added, updated


if __name__ == "__main__":
    app = create_app()
    app.run(debug=True, host="0.0.0.0", port=int(os.environ.get("PORT", 5000)))