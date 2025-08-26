# app.py
from flask import Flask
from pathlib import Path
from extensions import db

def create_app():
    app = Flask(__name__)
    Path("instance").mkdir(parents=True, exist_ok=True)
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:////app/instance/catalog.db"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    app.config["SECRET_KEY"] = "dev"

    db.init_app(app)

    @app.get("/")
    def index():
        return "cad4less catalog is up ✅"

    @app.get("/health")
    def health():
        return {"status": "ok"}

    # ---- PCs routes (you added earlier) ----
    from flask import render_template, request, redirect, url_for, flash
    from sqlalchemy.exc import IntegrityError
    from models import Category, Part, Build, BuildPart

    @app.get("/builds")
    def list_builds():
        builds = Build.query.order_by(Build.name).all()
        return render_template("builds_list.html", builds=builds)

    @app.get("/builds/<int:build_id>")
    def show_build(build_id):
        b = Build.query.get_or_404(build_id)
        total = 0
        items = []
        for bp in b.items:
            price = float(bp.part.price or 0)
            line_total = price * bp.quantity
            total += line_total
            items.append({"part": bp.part, "qty": bp.quantity, "price": price, "line_total": line_total})
        return render_template("build_detail.html", build=b, items=items, total=total)

    @app.get("/builds/new")
    def new_build():
        parts = Part.query.order_by(Part.title).all()
        return render_template("build_new.html", parts=parts)

    @app.post("/builds")
    def create_build():
        name = (request.form.get("name") or "").strip()
        if not name:
            flash("Please enter a build name.", "error")
            return redirect(url_for("new_build"))

        b = Build(name=name)
        db.session.add(b)
        try:
            db.session.flush()
        except IntegrityError:
            db.session.rollback()
            flash(f'Build "{name}" already exists.', "error")
            return redirect(url_for("new_build"))

        any_items = False
        for key in request.form:
            if not key.startswith("qty_"):
                continue
            try:
                part_id = int(key.split("_", 1)[1])
                qty = int(request.form.get(key) or "0")
            except ValueError:
                continue
            if qty > 0:
                any_items = True
                db.session.add(BuildPart(build_id=b.id, part_id=part_id, quantity=qty))

        if not any_items:
            db.session.rollback()
            flash("Please add at least one part (quantity > 0).", "error")
            return redirect(url_for("new_build"))

        db.session.commit()
        flash(f'Build "{b.name}" created!', "success")
        return redirect(url_for("show_build", build_id=b.id))

    # ---- CLI command (register after app is created) ----
    import click
    from flask.cli import with_appcontext
    from sqlalchemy.dialects.sqlite import insert

    @click.command("seed-categories")
    @with_appcontext
    def seed_categories():
        for n in ["CPU","GPU","Motherboard","RAM","Storage","PSU","Case","Cooler"]:
            db.session.execute(
                insert(Category).values(name=n).on_conflict_do_nothing(index_elements=["name"])
            )
        db.session.commit()
        click.echo("Seeded categories.")

    app.cli.add_command(seed_categories)

    return app