
from flask import Blueprint, render_template

bp = Blueprint('import_catalog', __name__, template_folder='../templates')

@bp.route('/')
def import_home():
    return render_template('import_form.html')
