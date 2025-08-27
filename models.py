# models.py
from __future__ import annotations

from extensions import db


class Category(db.Model):
    __tablename__ = "category"

    id = db.Column(db.Integer, primary_key=True)
    # Your logs showed UNIQUE on category.name, so keep it unique.
    name = db.Column(db.String(120), unique=True, nullable=False)

    # When a Category is deleted, keep Parts but set their category to NULL.
    parts = db.relationship(
        "Part",
        back_populates="category",
        passive_deletes=True,
    )

    def __repr__(self) -> str:
        return f"<Category id={self.id} name={self.name!r}>"


class Part(db.Model):
    __tablename__ = "part"

    id = db.Column(db.Integer, primary_key=True)

    # We upsert by name in the CSV import; make it unique to avoid duplicates.
    name = db.Column(db.String(255), unique=True, nullable=False)

    # Optional attributes used by the CSV importer (checks with hasattr in app.py).
    sku = db.Column(db.String(120), nullable=True)
    price = db.Column(db.Float, nullable=True)
    description = db.Column(db.Text, nullable=True)

    category_id = db.Column(
        db.Integer,
        db.ForeignKey("category.id", ondelete="SET NULL"),
        nullable=True,
    )
    category = db.relationship("Category", back_populates="parts")

    # Build association rows
    build_parts = db.relationship(
        "BuildPart",
        back_populates="part",
        cascade="all, delete-orphan",
    )

    # Convenience: view-only many-to-many to builds
    builds = db.relationship(
        "Build",
        secondary="build_part",
        viewonly=True,
        lazy="dynamic",
    )

    def __repr__(self) -> str:
        return f"<Part id={self.id} name={self.name!r}>"


class Build(db.Model):
    __tablename__ = "build"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime, server_default=db.func.now(), nullable=False)

    build_parts = db.relationship(
        "BuildPart",
        back_populates="build",
        cascade="all, delete-orphan",
    )

    # Convenience: view-only many-to-many to parts
    parts = db.relationship(
        "Part",
        secondary="build_part",
        viewonly=True,
        lazy="dynamic",
    )

    def __repr__(self) -> str:
        return f"<Build id={self.id} name={self.name!r}>"


class BuildPart(db.Model):
    __tablename__ = "build_part"

    # Composite PK keeps rows unique per (build, part)
    build_id = db.Column(
        db.Integer,
        db.ForeignKey("build.id", ondelete="CASCADE"),
        primary_key=True,
    )
    part_id = db.Column(
        db.Integer,
        db.ForeignKey("part.id", ondelete="CASCADE"),
        primary_key=True,
    )

    quantity = db.Column(db.Integer, nullable=False, default=1)

    build = db.relationship("Build", back_populates="build_parts")
    part = db.relationship("Part", back_populates="build_parts")

    def __repr__(self) -> str:
        return f"<BuildPart build_id={self.build_id} part_id={self.part_id} qty={self.quantity}>"