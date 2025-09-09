
from flask import Blueprint, render_template
from ..models import Build

bp = Blueprint('builds', __name__, template_folder='../templates')

@bp.route('/')
def list_builds():
    builds = Build.query.all()
    return render_template('builds_list.html', builds=builds)
