
import os

from flask import Flask
from .extensions import db
from .models import *


def create_app():
    app = Flask(__name__, instance_relative_config=True)
    os.makedirs(app.instance_path, exist_ok=True)
    db_path = os.path.join(app.instance_path, 'catalog.db')
    app.config['SQLALCHEMY_DATABASE_URI'] = f'sqlite:///{db_path}'
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    app.config['SECRET_KEY'] = 'dev'

    db.init_app(app)

    from .builds.routes import bp as builds_bp
    from .parts.routes import bp as parts_bp
    from .import_catalog.routes import bp as import_bp
    app.register_blueprint(builds_bp, url_prefix='/builds')
    app.register_blueprint(parts_bp, url_prefix='/parts')
    app.register_blueprint(import_bp, url_prefix='/import')

    @app.route('/')
    def index():
        from flask import redirect, url_for
        return redirect(url_for('builds.list_builds'))

    return app
