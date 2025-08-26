"""Main Flask application for managing prebuilt PC builds.

This file configures the Flask application, database, and user
authentication. It exposes routes for login, logout, listing builds
and creating/editing individual builds. The application uses SQLAlchemy
for data persistence and Flask‑Login for session management. Image
uploads are processed with Pillow to produce a hero and thumbnail
version for each build.
"""

import os
from pathlib import Path
from typing import Optional

from flask import (
    Flask,
    flash,
    redirect,
    render_template,
    request,
    url_for,
)
from flask_sqlalchemy import SQLAlchemy
from flask_login import (
    LoginManager,
    UserMixin,
    login_required,
    login_user,
    logout_user,
    current_user,
)
from flask_migrate import Migrate
from werkzeug.security import generate_password_hash, check_password_hash
from PIL import Image

# -----------------------------------------------------------------------------
# Flask configuration
# -----------------------------------------------------------------------------

# Create the Flask application instance. Configuration values are loaded from
# environment variables where possible to facilitate deployment in different
# environments (development vs production).
app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'CHANGE_ME')

# Default to an on‑disk SQLite database. In production you can provide a
# DATABASE_URL environment variable pointing to a different database backend.
app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get(
    'DATABASE_URL',
    'sqlite:///app.db'
)
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# Initialize extensions
db = SQLAlchemy(app)
migrate = Migrate(app, db)
login_manager = LoginManager(app)
login_manager.login_view = 'login'

# Define where uploaded images will be stored. When running locally or inside
# Docker this will exist on the container filesystem; you should mount
# persistent storage to `/app/static/uploads` via docker‑compose if you
# need persistence across restarts.
UPLOAD_FOLDER = Path(__file__).resolve().parent / 'static' / 'uploads'
UPLOAD_FOLDER.mkdir(parents=True, exist_ok=True)
app.config['UPLOAD_FOLDER'] = str(UPLOAD_FOLDER)

# -----------------------------------------------------------------------------
# Models
# -----------------------------------------------------------------------------


class User(UserMixin, db.Model):
    """Model representing an admin user.

    The application supports a single admin user for simplicity. Passwords
    should always be stored as hashes.
    """
    __tablename__ = 'users'
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(50), unique=True, nullable=False)
    password_hash = db.Column(db.String(128), nullable=False)

    def set_password(self, password: str) -> None:
        """Hashes and sets the user's password."""
        self.password_hash = generate_password_hash(password)

    def check_password(self, password: str) -> bool:
        """Verifies a plaintext password against the stored hash."""
        return check_password_hash(self.password_hash, password)


class Category(db.Model):
    """General purpose category model.

    Categories can be one of three types:

    - Part: describes a PC component category like CPU, GPU, RAM, etc.
    - Tier: describes the marketing tier (e.g. Economy, Standard, Premium).
    - Family: describes the processor family (e.g. Intel Core i7, AMD Ryzen 9).
    """
    __tablename__ = 'categories'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(50), nullable=False)
    type = db.Column(db.String(20), nullable=False)  # Part, Tier or Family

    # Establish a relationship to Part for categories of type 'Part'. This
    # attribute is only populated for categories representing component
    # categories (e.g. CPU, GPU, RAM). For other category types it will
    # simply be an empty collection. Using `lazy='dynamic'` enables
    # efficient querying.
    parts = db.relationship('Part', backref='category', lazy='dynamic')


class Part(db.Model):
    """Model representing an individual PC part/component."""
    __tablename__ = 'parts'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    category_id = db.Column(db.Integer, db.ForeignKey('categories.id'))
    category = db.relationship('Category')
    price = db.Column(db.Float, nullable=True)  # base price for this part


class Build(db.Model):
    """Model representing a PC build composed of multiple parts."""
    __tablename__ = 'builds'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    status = db.Column(db.String(20), default='Draft')  # Draft, Approved, Published

    # Foreign keys into Category for tier and family (single selection each)
    tier_id = db.Column(db.Integer, db.ForeignKey('categories.id'))
    family_id = db.Column(db.Integer, db.ForeignKey('categories.id'))
    tier = db.relationship('Category', foreign_keys=[tier_id], lazy='joined')
    family = db.relationship('Category', foreign_keys=[family_id], lazy='joined')

    # Paths to images (stored in static/uploads). These are optional.
    image_path = db.Column(db.String(200))
    thumb_path = db.Column(db.String(200))

    # Relationship to parts via association table BuildPart
    parts = db.relationship(
        'BuildPart',
        back_populates='build',
        cascade='all, delete‑orphan',
    )


class BuildPart(db.Model):
    """Association table linking a build to its selected parts."""
    __tablename__ = 'build_parts'
    id = db.Column(db.Integer, primary_key=True)
    build_id = db.Column(db.Integer, db.ForeignKey('builds.id'))
    part_id = db.Column(db.Integer, db.ForeignKey('parts.id'))
    price_override = db.Column(db.Float, nullable=True)  # override price for this part
    build = db.relationship('Build', back_populates='parts')
    part = db.relationship('Part')


# -----------------------------------------------------------------------------
# User loader for Flask‑Login
# -----------------------------------------------------------------------------

@login_manager.user_loader
def load_user(user_id: str) -> Optional[User]:
    """Flask‑Login user loader callback.

    Given a user ID, return the corresponding User object. Returns None if
    the user cannot be found.
    """
    try:
        return User.query.get(int(user_id))
    except (TypeError, ValueError):
        return None


# -----------------------------------------------------------------------------
# Authentication routes
# -----------------------------------------------------------------------------

@app.route('/login', methods=['GET', 'POST'])
def login():
    """Render the login page and authenticate the user.

    On GET requests this displays the login form. On POST requests it
    validates the provided credentials and logs the user in. Invalid
    credentials result in a flash message.
    """
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        user = User.query.filter_by(username=username).first()
        if user and user.check_password(password):
            login_user(user)
            return redirect(url_for('builds_list'))
        flash('Invalid username or password', 'danger')
    return render_template('login.html')


@app.route('/logout')
@login_required
def logout():
    """Log the user out and redirect to the login page."""
    logout_user()
    return redirect(url_for('login'))


# -----------------------------------------------------------------------------
# Build management routes
# -----------------------------------------------------------------------------

@app.route('/')
@login_required
def builds_list():
    """List all builds for the admin user.

    Displays builds in descending order of creation. Each entry shows the
    build name and status and provides a link to edit it.
    """
    builds = Build.query.order_by(Build.id.desc()).all()
    return render_template('builds_list.html', builds=builds)


@app.route('/build/new', methods=['GET', 'POST'])
@app.route('/build/<int:build_id>', methods=['GET', 'POST'])
@login_required
def new_build(build_id: Optional[int] = None):
    """Create a new build or edit an existing one.

    When accessed via GET, this route renders the build form. If build_id
    is provided, it loads the existing build; otherwise a new build is
    created. On POST, it processes the form data, saves or updates the build
    and its selected parts, and sets its status based on the action.
    """
    build: Optional[Build] = None
    if build_id:
        build = Build.query.get_or_404(build_id)

    # Fetch categories for the form. Part categories are those with type 'Part'.
    tiers = Category.query.filter_by(type='Tier').all()
    families = Category.query.filter_by(type='Family').all()
    part_categories = Category.query.filter_by(type='Part').all()

    if request.method == 'GET':
        return render_template(
            'build_form.html',
            build=build,
            tiers=tiers,
            families=families,
            part_categories=part_categories,
        )

    # POST: process submitted form data
    name = request.form.get('name') or (build.name if build else 'Untitled Build')
    if not build:
        build = Build(name=name)
        db.session.add(build)
    else:
        build.name = name

    # Assign tier and family categories
    tier_id = request.form.get('tier')
    family_id = request.form.get('family')
    build.tier_id = int(tier_id) if tier_id else None
    build.family_id = int(family_id) if family_id else None

    # Handle uploaded image if present
    image_file = request.files.get('image')
    if image_file and image_file.filename:
        # Ensure the build has an ID so filenames are stable
        db.session.flush()
        hero_path = UPLOAD_FOLDER / f'build{build.id}_hero.jpg'
        thumb_path = UPLOAD_FOLDER / f'build{build.id}_thumb.jpg'
        # Save hero image
        img = Image.open(image_file)
        img.thumbnail((1200, 1200))
        img.save(hero_path)
        # Save thumbnail
        img_thumb = Image.open(image_file)
        img_thumb.thumbnail((300, 300))
        img_thumb.save(thumb_path)
        # Store relative paths so they can be referenced in templates
        build.image_path = str(hero_path.relative_to(Path(__file__).resolve().parent / 'static'))
        build.thumb_path = str(thumb_path.relative_to(Path(__file__).resolve().parent / 'static'))

    # Clear existing parts on edit
    if build.parts:
        build.parts.clear()
    # Add selected parts
    for cat in part_categories:
        part_id = request.form.get(f'part_{cat.id}')
        override_price = request.form.get(f'price_{cat.id}')
        if part_id:
            association = BuildPart(build=build, part_id=int(part_id))
            if override_price:
                try:
                    association.price_override = float(override_price)
                except ValueError:
                    association.price_override = None
            build.parts.append(association)

    # Determine status based on action
    action = request.form.get('action', 'draft')
    if action == 'approve':
        build.status = 'Approved'
    elif action == 'publish':
        build.status = 'Published'
    else:
        build.status = 'Draft'

    db.session.commit()
    flash(f'Build "{build.name}" saved as {build.status}.', 'success')
    return redirect(url_for('builds_list'))


if __name__ == '__main__':
    # For local development only. Use Gunicorn for production.
    app.run(debug=True, host='0.0.0.0')