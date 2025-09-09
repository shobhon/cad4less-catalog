
from flask import Blueprint, render_template
from ..models import Part

bp = Blueprint('parts', __name__, template_folder='../templates')

@bp.route('/')
def list_parts():
    parts = Part.query.all()
    return render_template('parts_list.html', parts=parts)
