# models.py
from datetime import datetime
from flask_sqlalchemy import SQLAlchemy

# If your project uses extensions.py to create db = SQLAlchemy(), import from there instead.
db = SQLAlchemy()

class Category(db.Model):
    __tablename__ = "category"
    id   = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), unique=True, nullable=False)

    parts = db.relationship("Part", back_populates="category", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Category {self.name!r}>"


class Part(db.Model):
    __tablename__ = "part"
    id          = db.Column(db.Integer, primary_key=True)
    name        = db.Column(db.String(255), nullable=False, index=True)
    description = db.Column(db.Text, nullable=True)
    price       = db.Column(db.Float, nullable=True)  # Store numeric price
    brand       = db.Column(db.String(120), nullable=True)  # NEW
    url         = db.Column(db.String(500), nullable=True)  # NEW

    category_id = db.Column(db.Integer, db.ForeignKey("category.id"), nullable=True)
    category    = db.relationship("Category", back_populates="parts")

    build_parts = db.relationship("BuildPart", back_populates="part", cascade="all, delete-orphan")
    builds      = db.relationship("Build", secondary="build_part", viewonly=True, back_populates="parts")

    __table_args__ = (
        db.UniqueConstraint("name", "category_id", name="uq_part_name_category"),
    )

    def __repr__(self):
        return f"<Part {self.name!r}>"


class Build(db.Model):
    __tablename__ = "build"
    id         = db.Column(db.Integer, primary_key=True)
    name       = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)

    build_parts = db.relationship("BuildPart", back_populates="build", cascade="all, delete-orphan")
    parts       = db.relationship("Part", secondary="build_part", viewonly=True, back_populates="builds")

    def total_price(self) -> float:
        total = 0.0
        for bp in self.build_parts:
            unit = bp.part.price or 0.0
            qty  = bp.quantity or 1
            total += unit * qty
        return total

    def __repr__(self):
        return f"<Build {self.name!r}>"


class BuildPart(db.Model):
    __tablename__ = "build_part"
    build_id = db.Column(db.Integer, db.ForeignKey("build.id"), primary_key=True)
    part_id  = db.Column(db.Integer, db.ForeignKey("part.id"), primary_key=True)
    quantity = db.Column(db.Integer, nullable=False, default=1)

    build = db.relationship("Build", back_populates="build_parts")
    part  = db.relationship("Part", back_populates="build_parts")

    def __repr__(self):
        return f"<BuildPart build={self.build_id} part={self.part_id} qty={self.quantity}>"