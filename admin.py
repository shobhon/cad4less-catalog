# admin.py (Admin blueprint or routes file)

from flask import Blueprint, render_template, request, flash, redirect, url_for
from flask_wtf import FlaskForm
from flask_wtf.file import FileField, FileAllowed, FileRequired
from wtforms import SubmitField
from app.import_catalog import import_catalog  # our parsing function

admin_bp = Blueprint('admin', __name__, url_prefix='/admin')

class CatalogUploadForm(FlaskForm):
    csv_file = FileField('Catalog CSV', validators=[
        FileRequired(message="Please select a CSV file"),
        FileAllowed(['csv'], 'CSV files only!')
    ])
    submit = SubmitField('Upload CSV')

@admin_bp.route('/upload_catalog', methods=['GET', 'POST'])
def upload_catalog():
    form = CatalogUploadForm()
    imported_products = []
    if form.validate_on_submit():
        file_data = form.csv_file.data  # FileStorage instance
        try:
            # Import products from the uploaded CSV
            imported_products = import_catalog(file_data)
            count = len(imported_products)
            flash(f"Successfully imported {count} products.", 'success')
        except Exception as e:
            # Handle parsing or DB errors
            flash(f"Import failed: {str(e)}", 'danger')
            imported_products = []
        return redirect(url_for('admin.upload_catalog'))
    return render_template('admin/dashboard.html', form=form, imported_products=imported_products)
