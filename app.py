# app.py — Build price editing + safe on-start column add
import os, io, csv, re
from datetime import datetime
from flask import (
    Flask, render_template, render_template_string, request,
    redirect, url_for, flash, jsonify, Response, abort
)
from werkzeug.utils import secure_filename
from sqlalchemy import inspect, text  # for lightweight column check / add

from models import db, Category, Part, Build, BuildPart

ALLOWED_IMPORT_EXTS = {"csv"}

def create_app():
    app = Flask(__name__, instance_relative_config=True)

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

    db.init_app(app)
    with app.app_context():
        try:
            from flask_migrate import upgrade
            upgrade()
        except Exception:
            db.create_all()
        _ensure_build_price_column()  # <-- ensure Build.price exists

    @app.get("/__routes")
    def __routes():
        lines = []
        for r in app.url_map.iter_rules():
            lines.append(f"{','.join(sorted(r.methods))}  {r.rule}  -> {r.endpoint}")
        return Response("<pre>" + "\n".join(sorted(lines)) + "</pre>", mimetype="text/html")

    @app.get("/health")
    def health():
        return {"ok": True, "time": datetime.utcnow().isoformat()}

    @app.route("/")
    def home():
        return redirect(url_for("list_builds"))

    @app.route("/products")
    def products_home():
        return redirect(url_for("list_builds"))

    @app.post("/builds/delete")
    def delete_builds():
        ids = request.form.getlist("selected_ids")
        if not ids:
            flash("No PCs selected for deletion.", "error")
            return redirect(url_for("list_builds"))
        deleted = 0
        for s in ids:
            try:
                bid = int(s)
            except ValueError:
                continue
            b = Build.query.get(bid)
            if b:
                db.session.delete(b)
                deleted += 1
        db.session.commit()
        flash(f"Deleted {deleted} PC(s).", "success")
        return redirect(url_for("list_builds"))

    # ---------- PARTS ----------
    @app.get("/parts")
    def list_parts():
        parts = Part.query.order_by(Part.name).all()
        safe = []
        for p in parts:
            safe.append({
                "id": p.id,
                "name": p.name,
                "category": p.category.name if p.category else "",
                "brand": getattr(p, "brand", None),
                "url": getattr(p, "url", None),
                "price": p.price,
            })
        return render_template("parts_list.html", parts=safe)

    @app.post("/parts/delete")
    def delete_parts_bulk():
        ids = request.form.getlist("selected_ids")
        if not ids:
            flash("No parts selected for deletion.", "error")
            return redirect(url_for("list_parts"))
        deleted = 0
        for s in ids:
            try:
                pid = int(s)
            except ValueError:
                continue
            p = Part.query.get(pid)
            if p:
                BuildPart.query.filter_by(part_id=p.id).delete()
                db.session.delete(p)
                deleted += 1
        db.session.commit()
        flash(f"Deleted {deleted} part(s).", "success")
        return redirect(url_for("list_parts"))

    @app.post("/parts/<int:part_id>/delete")
    def delete_part(part_id: int):
        BuildPart.query.filter_by(part_id=part_id).delete()
        part = Part.query.get_or_404(part_id)
        db.session.delete(part)
        db.session.commit()
        flash("Part deleted.", "success")
        return redirect(url_for("list_parts"))
    
    from sqlalchemy import text

    @app.post("/parts/<int:part_id>/update")
    def update_part_fields(part_id: int):
        part = Part.query.get_or_404(part_id)
        brand = (request.form.get("brand") or "").strip()
        price_raw = request.form.get("price", "")
        price = _parse_price(price_raw)

        # If model maps the columns, use ORM; otherwise write directly (fallback)
        changed = False
        if hasattr(Part, "brand"):
            if (brand or None) != getattr(part, "brand", None):
                part.brand = brand or None
                changed = True
        else:
            table = getattr(Part, "__tablename__", Part.__table__.name)
            db.session.execute(text(f'UPDATE "{table}" SET brand=:brand WHERE id=:id'),
                            {"brand": (brand or None), "id": part.id})
            changed = True

        if price is not None or getattr(part, "price", None) is not None:
            if hasattr(Part, "price"):
                if part.price != price:
                    part.price = price
                    changed = True
            else:
                table = getattr(Part, "__tablename__", Part.__table__.name)
                db.session.execute(text(f'UPDATE "{table}" SET price=:price WHERE id=:id'),
                                {"price": price, "id": part.id})
                changed = True

        if changed:
            db.session.commit()
            flash("Part updated.", "success")
        else:
            flash("No changes detected.", "success")
        return redirect(url_for("list_parts"))

    # ---------- BUILDS ----------
    @app.get("/builds")
    def list_builds():
        records = Build.query.order_by(Build.id.desc()).all()
        safe_builds = []
        for b in records:
            safe_builds.append({
                "id": b.id,
                "name": getattr(b, "name", ""),
                "price": getattr(b, "price", None),
                "created_at": getattr(b, "created_at", None),
            })
        return render_template("builds_list.html", builds=safe_builds)

    @app.get("/builds/<int:build_id>")
    def build_specification(build_id: int):
        build = Build.query.get(build_id)
        if not build:
            abort(404)

        # Build a safe dict for the template (prevents Jinja UndefinedError)
        build_safe = {
            "id": build.id,
            "name": getattr(build, "name", "") or "",
            "price": getattr(build, "price", None),
            "created_at": getattr(build, "created_at", None),
        }

        # Collect parts grouped by category
        groups = {}
        total = 0.0
        # be defensive: handle missing relationship gracefully
        for bp in getattr(build, "build_parts", []) or []:
            part = getattr(bp, "part", None)
            cat = (getattr(getattr(part, "category", None), "name", None)) or "Uncategorized"
            qty = getattr(bp, "quantity", 1) or 1
            price = getattr(part, "price", None)
            name = getattr(part, "name", None) or "(missing part)"

            subtotal = (price or 0.0) * qty
            total += subtotal

            groups.setdefault(cat, []).append({
                "name": name,
                "price": price,
                "qty": qty,
                "subtotal": subtotal,
            })

        # Order categories (extras at the end)
        order = ["CPU","Motherboard","Memory","GPU","Storage","PSU","Case","OS",
                "Optical Drive","Storage Controller","RAID","I/O Ports","Peripherals","Uncategorized"]
        ordered_groups, seen = [], set()
        for name in order:
            if name in groups:
                ordered_groups.append((name, groups[name])); seen.add(name)
        for name, items in sorted(groups.items()):
            if name not in seen:
                ordered_groups.append((name, items))

        return render_template(
            "build_specification.html",
            build=build_safe,
            groups=ordered_groups,
            total=total,
        )

    # NEW: update Build.price
    @app.post("/builds/<int:build_id>/price")
    def update_build_price(build_id: int):
        build = Build.query.get_or_404(build_id)
        price_raw = request.form.get("price", "")
        price = _parse_price(price_raw)
        if hasattr(Build, "price"):
            build.price = price
            db.session.commit()
        else:
            table = getattr(Build, "__tablename__", Build.__table__.name)
            db.session.execute(text(f'UPDATE "{table}" SET price=:price WHERE id=:id'), {"price": price, "id": build.id})
            db.session.commit()
        flash("Build price updated.", "success")
        return redirect(url_for("list_builds"))

    @app.get("/builds/new")
    def new_build_form():
        categories = Category.query.order_by(Category.name).all()
        parts_by_cat = {
            c.id: Part.query.filter_by(category_id=c.id).order_by(Part.name).all()
            for c in categories
        }
        return render_template("new_build.html", categories=categories, parts_by_cat=parts_by_cat)

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
    
    # --- Add New Part (form) ---
    @app.get("/parts/new")
    def new_part_form():
        return render_template("part_new.html")

    # --- Create New Part (submit) ---
    @app.post("/parts/new")
    def create_part():
        name = (request.form.get("name") or "").strip()
        brand = (request.form.get("brand") or "").strip() or None
        price = _parse_price(request.form.get("price", ""))

        if not name:
            flash("Part name is required.", "error")
            return redirect(url_for("new_part_form"))

        # Optional: ensure columns exist (dev-friendly)
        _ensure_part_brand_column()

        # Create
        part = Part(name=name)
        if hasattr(Part, "brand"):
            part.brand = brand
        if hasattr(Part, "price"):
            part.price = price
        db.session.add(part)
        db.session.commit()

        flash("Part added.", "success")
        return redirect(url_for("list_parts"))

    # --- Edit Part (form) ---
    @app.get("/parts/<int:part_id>")
    def edit_part_form(part_id: int):
        part = Part.query.get_or_404(part_id)
        # Make a safe dict so template won't break if some attrs are missing
        data = {
            "id": part.id,
            "name": part.name,
            "brand": getattr(part, "brand", "") or "",
            "price": getattr(part, "price", None),
        }
        return render_template("part_edit.html", part=data)

    # --- Update Part (submit) ---
    @app.post("/parts/<int:part_id>")
    def update_part_submit(part_id: int):
        part = Part.query.get_or_404(part_id)
        name = (request.form.get("name") or "").strip()
        brand = (request.form.get("brand") or "").strip() or None
        price = _parse_price(request.form.get("price", ""))

        if not name:
            flash("Part name is required.", "error")
            return redirect(url_for("edit_part_form", part_id=part.id))

        # Ensure columns exist if running in dev without migrations
        _ensure_part_brand_column()

        # Update via ORM when columns exist; fallback to SQL if model lacks fields
        changed = False

        if part.name != name:
            part.name = name
            changed = True

        if hasattr(Part, "brand"):
            if (brand or None) != getattr(part, "brand", None):
                part.brand = brand
                changed = True
        else:
            table = getattr(Part, "__tablename__", Part.__table__.name)
            db.session.execute(text(f'UPDATE "{table}" SET brand=:brand WHERE id=:id'),
                            {"brand": brand, "id": part.id})
            changed = True

        if hasattr(Part, "price"):
            if getattr(part, "price", None) != price:
                part.price = price
                changed = True
        else:
            table = getattr(Part, "__tablename__", Part.__table__.name)
            db.session.execute(text(f'UPDATE "{table}" SET price=:price WHERE id=:id'),
                            {"price": price, "id": part.id})
            changed = True

        if changed:
            db.session.commit()
            flash("Part updated.", "success")
        else:
            flash("No changes detected.", "success")

        return redirect(url_for("list_parts"))

    # ---------- IMPORT ----------
    @app.route("/import", methods=["GET", "POST"])
    def import_catalog_route():
        if request.method == "GET":
            return render_template("import_form.html")

        f = request.files.get("file")
        if not f or not f.filename:
            flash("Please choose a CSV file.", "error")
            return redirect(url_for("import_catalog_route"))
        filename = secure_filename(f.filename)
        if "." not in filename or filename.rsplit(".", 1)[1].lower() not in ALLOWED_IMPORT_EXTS:
            flash("Only .csv files are allowed.", "error")
            return redirect(url_for("import_catalog_route"))

        result = import_csv_into_db(f.read())
        db.session.commit()

        if result.get("mode") == "shopify":
            flash(
                f"Shopify CSV imported: {result.get('rows_seen',0)} rows, "
                f"{result.get('builds_created',0)} builds created, "
                f"{result.get('builds_updated',0)} updated, "
                f"{result.get('parts_created',0)} parts created, "
                f"{result.get('links_created',0)} links.",
                "success"
            )
        else:
            flash(
                f"Simple CSV imported: {result.get('parts_added',0)} parts added, "
                f"{result.get('parts_updated',0)} updated.",
                "success"
            )
        return redirect(url_for("list_builds"))

    app.add_url_rule("/import", endpoint="import_catalog", view_func=import_catalog_route, methods=["GET", "POST"])
    app.add_url_rule("/builds/new", endpoint="new_build", view_func=new_build_form)

    return app


# ---------------- Utilities / Import helpers ----------------

def _ensure_build_price_column():
    """Ensure Build.price column exists (dev-friendly auto-migration)."""
    try:
        inspector = inspect(db.engine)
        table_name = getattr(Build, "__tablename__", Build.__table__.name)
        cols = [c["name"].lower() for c in inspector.get_columns(table_name)]
        if "price" not in cols:
            # SQLite & most SQL dialects accept this form for adding a nullable column
            db.session.execute(text(f'ALTER TABLE "{table_name}" ADD COLUMN price FLOAT'))
            db.session.commit()
    except Exception:
        # If anything fails (e.g., permissions), we just proceed without hard failing.
        db.session.rollback()


# Move _ensure_part_brand_column to top-level
def _ensure_part_brand_column():
    """Ensure Part.brand exists (and price already exists in your model)."""
    try:
        inspector = inspect(db.engine)
        table_name = getattr(Part, "__tablename__", Part.__table__.name)
        cols = [c["name"].lower() for c in inspector.get_columns(table_name)]
        changed = False
        if "brand" not in cols:
            db.session.execute(text(f'ALTER TABLE "{table_name}" ADD COLUMN brand TEXT'))
            changed = True
        # If your Part model might lack price in DB, uncomment the next 3 lines:
        # if "price" not in cols:
        #     db.session.execute(text(f'ALTER TABLE "{table_name}" ADD COLUMN price FLOAT'))
        #     changed = True
        if changed:
            db.session.commit()
    except Exception:
        db.session.rollback()

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
    text = file_bytes.decode("utf-8-sig", errors="ignore")
    sio = io.StringIO(text)
    reader = csv.DictReader(sio)
    fieldnames = [f.strip() for f in (reader.fieldnames or [])]
    if any(fn.lower() == "body (html)".lower() for fn in fieldnames):
        sio2 = io.StringIO(text)
        reader2 = csv.DictReader(sio2)
        return _import_shopify_pc_csv(reader2)
    else:
        sio3 = io.StringIO(text)
        reader3 = csv.DictReader(sio3)
        added, updated = 0, 0
        for row in reader3:
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
                    db.session.add(cat); db.session.flush()
            q = Part.query.filter_by(name=product_name.strip())
            if cat:
                q = q.filter_by(category_id=cat.id)
            part = q.first()
            if not part:
                part = Part(name=product_name.strip(), category=cat, price=price)
                if hasattr(part, "brand"): part.brand = brand
                if hasattr(part, "url"):   part.url = url
                db.session.add(part); added += 1
            else:
                changed = False
                if hasattr(part, "brand") and brand and part.brand != brand:
                    part.brand = brand; changed = True
                if hasattr(part, "url") and url and part.url != url:
                    part.url = url; changed = True
                if price is not None and part.price != price:
                    part.price = price; changed = True
                if changed: updated += 1
        return {"mode": "simple", "parts_added": added, "parts_updated": updated}

def _import_shopify_pc_csv(reader: csv.DictReader):
    builds_created = builds_updated = 0
    parts_created = links_created = 0
    rows_seen = 0
    for row in reader:
        rows_seen += 1
        title = _pick(row, "Title")
        body_html = row.get("Body (HTML)")
        if not title or not body_html or "<" not in str(body_html):
            continue
        status = (row.get("Status") or "").strip().lower()
        if status and status != "active":
            continue
        build = Build.query.filter_by(name=title.strip()).first()
        if not build:
            build = Build(name=title.strip(), created_at=datetime.utcnow())
            db.session.add(build); db.session.flush(); builds_created += 1
        else:
            builds_updated += 1
        parts_by_cat = _extract_parts_from_spec_html(body_html)
        BuildPart.query.filter_by(build_id=build.id).delete()
        for cat_name, items in parts_by_cat.items():
            category = Category.query.filter_by(name=cat_name).first()
            if not category:
                category = Category(name=cat_name)
                db.session.add(category); db.session.flush()
            for item in items:
                if not item: continue
                part = Part.query.filter_by(name=item.strip(), category_id=category.id).first()
                if not part:
                    part = Part(name=item.strip(), category=category)
                    db.session.add(part); db.session.flush(); parts_created += 1
                db.session.add(BuildPart(build_id=build.id, part_id=part.id, quantity=1)); links_created += 1
    return {
        "mode": "shopify",
        "rows_seen": rows_seen,
        "builds_created": builds_created,
        "builds_updated": builds_updated,
        "parts_created": parts_created,
        "links_created": links_created,
    }

def _extract_parts_from_spec_html(html_text: str) -> dict:
    try:
        from bs4 import BeautifulSoup
    except Exception:
        return {}
    soup = BeautifulSoup(html_text, "html.parser")
    def _clean(s):
        if s is None: return None
        s = re.sub(r"[\u00AE\u2122]", "", str(s))
        s = re.sub(r"\s+", " ", s).strip()
        return None if s.upper() in {"N/A", "NA", "NONE", "-", ""} else s
    pairs = []
    for tr in soup.find_all("tr"):
        cells = tr.find_all(["td", "th"])
        if len(cells) >= 2:
            label = _clean(cells[0].get_text(" ", strip=True))
            value = _clean(" ".join(c.get_text(" ", strip=True) for c in cells[1:]))
            if label and value:
                pairs.append((label, value))
    LABEL_TO_CATEGORY = {
        "Processor": "CPU", "CPU": "CPU",
        "System Board": "Motherboard", "Motherboard": "Motherboard",
        "RAM": "Memory", "Memory": "Memory",
        "Graphics": "GPU", "Graphics Card": "GPU", "GPU": "GPU",
        "Drive 1": "Storage", "Drive 2": "Storage", "Drive 3": "Storage", "Storage": "Storage",
        "Power Supply": "PSU", "PSU": "PSU",
        "Case": "Case",
        "Optical Drive": "Optical Drive",
        "OS": "OS", "Operating System": "OS",
        "Controller": "Storage Controller",
        "RAID": "RAID",
        "Ports": "I/O Ports",
        "Input Devices": "Peripherals",
    }
    SKIP = {"System Status", "Tech Support", "Warranty"}
    out = {}
    for label, value in pairs:
        if label in SKIP: continue
        cat = LABEL_TO_CATEGORY.get(label)
        if not cat: continue
        out.setdefault(cat, []).append(value)
    return out

if __name__ == "__main__":
    app = create_app()
    app.run(debug=True, host="0.0.0.0", port=int(os.environ.get("PORT", 5000)))