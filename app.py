# app.py
import os
import csv
import re
from decimal import Decimal, InvalidOperation
from datetime import datetime

from flask import (
    Flask, render_template, render_template_string, request,
    redirect, url_for, flash, jsonify
)
from werkzeug.utils import secure_filename

from extensions import db
from models import Category, Part, Build, BuildPart


# -------------------------
# Helpers
# -------------------------

ALLOWED_EXTENSIONS = {"csv"}


def _clean_price(val):
    if val is None:
        return None
    s = str(val).strip()
    if not s:
        return None
    # remove currency symbols, commas, spaces
    s = re.sub(r"[^\d\.\-]", "", s)
    if not s:
        return None
    try:
        # Use Decimal if your Part.price is Numeric; float is OK if it's Float
        return Decimal(s)
    except InvalidOperation:
        try:
            return Decimal(str(float(s)))
        except Exception:
            return None


def _pick(row, *candidates):
    """Pick first present (case-insensitive) key from DictReader row."""
    lower = {k.lower().strip(): k for k in row.keys()}
    for cand in candidates:
        key = lower.get(cand.lower().strip())
        if key is not None:
            return row.get(key, "").strip()
    return ""


def _smart_render(template_name, **ctx):
    """Try to render a Jinja template; fall back to a minimal inline HTML."""
    try:
        return render_template(template_name, **ctx)
    except Exception:
        # Fallbacks so the app still works without templates present.
        if template_name == "builds_list.html":
            builds = ctx.get("builds", [])
            return render_template_string(
                """
                <!doctype html><html><head><title>Builds</title></head><body>
                <h1>Builds</h1>
                <p><a href="{{ url_for('new_build_form') }}">New Build</a> |
                   <a href="{{ url_for('import_catalog_route') }}">Import CSV</a> |
                   <a href="{{ url_for('list_products') }}">Products</a></p>
                {% if builds %}
                <ul>
                  {% for b in builds %}
                    <li>#{{ b.id }} - {{ b.name }}{% if b.created_at %} ({{ b.created_at }}){% endif %}</li>
                  {% endfor %}
                </ul>
                {% else %}
                <p>No builds yet.</p>
                {% endif %}
                </body></html>
                """,
                **ctx,
            )
        if template_name == "new_build.html":
            return render_template_string(
                """
                <!doctype html><html><head><title>New Build</title></head><body>
                <h1>Create Build</h1>
                <form method="post" action="{{ url_for('create_build') }}">
                  <label>Name <input type="text" name="name" required></label>
                  <button type="submit">Create</button>
                </form>
                <p><a href="{{ url_for('list_builds') }}">Back to builds</a></p>
                </body></html>
                """,
                **ctx,
            )
        if template_name == "import.html":
            return render_template_string(
                """
                <!doctype html><html><head><title>Import CSV</title></head><body>
                <h1>Import Products (CSV)</h1>
                <form method="post" enctype="multipart/form-data" action="{{ url_for('import_catalog_route') }}">
                  <input type="file" name="file" accept=".csv" required>
                  <button type="submit">Upload & Import</button>
                </form>
                <p><a href="{{ url_for('list_products') }}">View Products</a> |
                   <a href="{{ url_for('list_builds') }}">Back to builds</a></p>
                {% with messages = get_flashed_messages() %}
                  {% if messages %}
                    <ul>{% for m in messages %}<li>{{ m }}</li>{% endfor %}</ul>
                  {% endif %}
                {% endwith %}
                </body></html>
                """,
                **ctx,
            )
        if template_name == "products_list.html":
            parts = ctx.get("parts", [])
            return render_template_string(
                """
                <!doctype html><html><head><title>Products</title></head><body>
                <h1>Products</h1>
                <p><a href="{{ url_for('import_catalog_route') }}">Import CSV</a> |
                   <a href="{{ url_for('list_builds') }}">Builds</a></p>
                {% if parts %}
                <table border="1" cellpadding="6" cellspacing="0">
                  <thead>
                    <tr><th>ID</th><th>Name</th><th>Category</th><th>Brand</th><th>Price</th><th>URL</th><th>Actions</th></tr>
                  </thead>
                  <tbody>
                    {% for p in parts %}
                      <tr>
                        <td>{{ p.id }}</td>
                        <td>{{ p.name }}</td>
                        <td>{{ p.category.name if p.category else '' }}</td>
                        <td>{{ p.brand or '' }}</td>
                        <td>{{ p.price or '' }}</td>
                        <td>{% if p.url %}<a target="_blank" href="{{ p.url }}">link</a>{% endif %}</td>
                        <td>
                          <form method="post" action="{{ url_for('delete_product', part_id=p.id) }}" onsubmit="return confirm('Delete this product?');">
                            <button type="submit">Delete</button>
                          </form>
                        </td>
                      </tr>
                    {% endfor %}
                  </tbody>
                </table>
                {% else %}
                  <p>No products yet.</p>
                {% endif %}
                </body></html>
                """,
                **ctx,
            )
        # Default bare fallback
        return render_template_string("<pre>Missing template: {{ name }}</pre>", name=template_name, **ctx)


def allowed_file(filename: str) -> bool:
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


def import_csv_into_db(csv_path: str):
    """Import products from CSV file. Returns (created_parts, updated_parts, created_categories)."""
    created_parts = 0
    updated_parts = 0
    created_categories = 0

    # Defensive: handle \ufeff (BOM) with utf-8-sig
    with open(csv_path, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames:
            return (0, 0, 0)

        for row in reader:
            category_name = _pick(row, "Category", "Category Name", "Type", "Group")
            product_name = _pick(row, "Product Name", "Name", "Part", "Item")
            brand = _pick(row, "Brand", "Manufacturer", "Maker")
            url = _pick(row, "URL", "Link", "Product URL", "Href")
            price_raw = _pick(row, "Price", "Cost", "MSRP", "Unit Price")

            if not category_name or not product_name:
                # Skip incomplete rows
                continue

            # get or create category
            cat = Category.query.filter_by(name=category_name).first()
            if not cat:
                cat = Category(name=category_name)
                db.session.add(cat)
                try:
                    db.session.flush()
                except Exception:
                    db.session.rollback()
                    # try to refetch (race)
                    cat = Category.query.filter_by(name=category_name).first()
                else:
                    created_categories += 1

            price = _clean_price(price_raw)

            # Upsert part by (name, category)
            part = Part.query.filter_by(name=product_name, category_id=cat.id).first()
            if part:
                # Update simple fields if provided
                changed = False
                if brand and brand != (part.brand or ""):
                    part.brand = brand
                    changed = True
                if url and url != (part.url or ""):
                    part.url = url
                    changed = True
                if price is not None and str(price) != str(part.price) if part.price is not None else True:
                    # store Decimal or float depending on model
                    part.price = price
                    changed = True
                if changed:
                    updated_parts += 1
            else:
                part = Part(
                    name=product_name,
                    category_id=cat.id,
                    brand=brand or None,
                    url=url or None,
                    price=price,
                )
                db.session.add(part)
                created_parts += 1

        db.session.commit()

    return (created_parts, updated_parts, created_categories)


# -------------------------
# Application Factory
# -------------------------

def create_app():
    app = Flask(__name__, instance_relative_config=True)

    # Ensure instance/ exists before initializing the DB
    os.makedirs(app.instance_path, exist_ok=True)

    # Config
    default_db_path = os.path.join(app.instance_path, "catalog.db")
    default_db_uri = f"sqlite:///{default_db_path}"

    # Allow either CATALOG_SQLALCHEMY_DATABASE_URI or SQLALCHEMY_DATABASE_URI to override
    app.config["SQLALCHEMY_DATABASE_URI"] = (
        os.environ.get("CATALOG_SQLALCHEMY_DATABASE_URI")
        or os.environ.get("SQLALCHEMY_DATABASE_URI")
        or default_db_uri
    )
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev")

    # Uploads folder (inside instance/)
    upload_folder = os.path.join(app.instance_path, "uploads")
    os.makedirs(upload_folder, exist_ok=True)
    app.config["UPLOAD_FOLDER"] = upload_folder

    # Init DB
    db.init_app(app)

    with app.app_context():
        db.create_all()

    # -------------
    # Routes
    # -------------

    @app.get("/health")
    def health():
        return jsonify({"status": "ok"})

    @app.get("/")
    def home():
        return redirect(url_for("list_builds"))

    # Builds
    @app.get("/builds")
    def list_builds():
        # Be tolerant: if model has created_at use it, otherwise order by id
        order_col = Build.created_at if hasattr(Build, "created_at") else Build.id
        builds = Build.query.order_by(order_col.desc()).all()
        return _smart_render("builds_list.html", builds=builds)

    @app.get("/builds/new")
    def new_build_form():
        return _smart_render("new_build.html")

    @app.post("/builds")
    def create_build():
        name = (request.form.get("name") or "").strip()
        if not name:
            flash("Build name is required.")
            return redirect(url_for("new_build_form"))
        b = Build(name=name)
        # If your model doesn't auto-set created_at, set it here
        if hasattr(b, "created_at") and getattr(b, "created_at") is None:
            b.created_at = datetime.utcnow()
        db.session.add(b)
        db.session.commit()
        flash(f"Build '{name}' created.")
        return redirect(url_for("list_builds"))

    # Import CSV (endpoint kept as 'import_catalog_route' for existing templates)
    @app.route("/import", methods=["GET", "POST"])
    def import_catalog_route():
        if request.method == "GET":
            return _smart_render("import.html")

        # POST
        if "file" not in request.files:
            flash("No file part in the request.")
            return redirect(url_for("import_catalog_route"))

        file = request.files["file"]
        if file.filename == "":
            flash("No file selected.")
            return redirect(url_for("import_catalog_route"))

        if not allowed_file(file.filename):
            flash("Unsupported file type. Please upload a .csv file.")
            return redirect(url_for("import_catalog_route"))

        filename = secure_filename(file.filename)
        save_path = os.path.join(app.config["UPLOAD_FOLDER"], filename)
        file.save(save_path)

        try:
            created, updated, created_cats = import_csv_into_db(save_path)
        except Exception as e:
            db.session.rollback()
            flash(f"Import failed: {e}")
            return redirect(url_for("import_catalog_route"))

        flash(f"Import done. Categories: +{created_cats}, Parts created: +{created}, Parts updated: {updated}.")
        return redirect(url_for("import_catalog_route"))

    # Products listing & deletion
    @app.get("/products")
    def list_products():
        parts = Part.query.order_by(Part.id.desc()).all()
        # eager load category if relationship named 'category' exists
        return _smart_render("products_list.html", parts=parts)

    @app.post("/products/<int:part_id>/delete")
    def delete_product(part_id):
        part = Part.query.get_or_404(part_id)
        # clean up any build-part links first
        BuildPart.query.filter_by(part_id=part.id).delete()
        db.session.delete(part)
        db.session.commit()
        flash(f"Deleted product #{part_id} - {part.name}")
        return redirect(url_for("list_products"))

    # Small JSON helper (optional)
    @app.get("/api/products")
    def api_products():
        parts = Part.query.order_by(Part.id.desc()).all()
        data = []
        for p in parts:
            data.append(
                {
                    "id": p.id,
                    "name": p.name,
                    "category": getattr(p.category, "name", None),
                    "brand": getattr(p, "brand", None),
                    "url": getattr(p, "url", None),
                    "price": str(p.price) if getattr(p, "price", None) is not None else None,
                }
            )
        return jsonify(data)

    # Optional: simple CLI to seed a few categories
    @app.cli.command("seed-categories")
    def seed_categories():
        base = ["CPU", "GPU", "Motherboard", "RAM", "Storage", "Case", "PSU", "Cooler"]
        created = 0
        for name in base:
            if not Category.query.filter_by(name=name).first():
                db.session.add(Category(name=name))
                created += 1
        db.session.commit()
        print(f"Seeded categories: {created}")

    return app


# Gunicorn entry
app = create_app()