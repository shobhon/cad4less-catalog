from extensions import db

class Category(db.Model):
    __tablename__ = 'category'
    id   = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), unique=True, nullable=False)

    parts = db.relationship('Part', back_populates='category', cascade='all,delete-orphan')

class Part(db.Model):
    __tablename__ = 'part'
    id    = db.Column(db.Integer, primary_key=True)
    sku   = db.Column(db.String(120), unique=True, nullable=False)
    title = db.Column(db.String(255), nullable=False)
    price = db.Column(db.Numeric(10, 2), nullable=True)

    category_id = db.Column(db.Integer, db.ForeignKey('category.id'), nullable=False)
    category    = db.relationship('Category', back_populates='parts')

class Build(db.Model):
    __tablename__ = 'build'
    id   = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), unique=True, nullable=False)

    items = db.relationship('BuildPart', back_populates='build', cascade='all,delete-orphan')

class BuildPart(db.Model):
    __tablename__ = 'build_part'
    build_id = db.Column(db.Integer, db.ForeignKey('build.id'), primary_key=True)
    part_id  = db.Column(db.Integer, db.ForeignKey('part.id'),  primary_key=True)
    quantity = db.Column(db.Integer, nullable=False, default=1)

    build = db.relationship('Build', back_populates='items')
    part  = db.relationship('Part')
