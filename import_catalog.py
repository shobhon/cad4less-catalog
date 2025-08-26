#!/usr/bin/env python3
"""
Import products from a Shopify CSV file into your local database.

This module exposes a single function, `import_catalog_from_csv`, which
accepts a file-like object (the uploaded CSV) and parses it row by row,
grouping by product handle. For each unique product, it extracts the full
specification table from the 'Body (HTML)' column using BeautifulSoup,
creates or updates categories and parts, and saves a Build in draft status.
Images in the 'Image Src' or 'Variant Image' fields are downloaded and
stored under static/uploads.

Usage (in Flask context):
    from import_catalog import import_catalog_from_csv
    with app.app_context():
        imported_builds = import_catalog_from_csv(file)
"""

import csv
import io
import os
from collections import defaultdict
from pathlib import Path
from typing import Dict, List, Optional

from bs4 import BeautifulSoup
from PIL import Image
import requests

from models import Category, Part, Build, BuildPart  # move models to models.py
from extensions import db  # move db to extensions.py

# Category mapping similar to JSON import
CATEGORY_MAPPING = {
    "Processor": "Processor",
    "System Board": "Motherboard",
    "Drive 1": "Storage",
    "Drive 2": "Storage",
    "Drive 3": "Storage",
    "Drive 4": "Storage",
    "Drive 5": "Storage",
    "Drive 6": "Storage",
    "RAM": "Memory",
    "Graphics Card": "Graphics Card",
    "Case": "Case",
    "Power Supply": "Power Supply",
    "Optical Drive": "Optical Drive",
    "Cooler": "Cooler",
    "Fans": "Fans",
}

# Tier and processor family tags (case-insensitive) – can extend as needed
TIER_OPTIONS = ["Economy", "Standard", "High-End", "Premium"]
FAMILY_OPTIONS = ["Intel Core i5", "Intel Core i7", "Intel Core i9", "Intel Xeon"]

def _normalize_tag(value: str) -> str:
    """Normalize tags by removing trademark symbols and punctuation."""
    for sym in ("®", "™"):
        value = value.replace(sym, "")
    value = value.replace("\xa0", " ")
    return "".join(ch for ch in value if ch.isalnum() or ch.isspace()).strip().lower()

def parse_spec_table(html: str) -> Dict[str, str]:
    """Extract specification rows from product body HTML (CSV)."""
    soup = BeautifulSoup(html or "", "html.parser")
    table = soup.find("table")
    specs = {}
    if table:
        for row in table.find_all("tr"):
            cells = row.find_all(["th", "td"])
            if len(cells) >= 2:
                key = cells[0].get_text(strip=True)
                val = cells[1].get_text(strip=True)
                specs[key] = val
    return specs

def find_or_create_category(name: str, type_: str) -> Category:
    """Get or create a Category by name and type."""
    cat = Category.query.filter_by(name=name, type=type_).first()
    if not cat:
        cat = Category(name=name, type=type_)
        db.session.add(cat)
        db.session.commit()
    return cat

def find_or_create_part(name: str, category: Category) -> Part:
    """Get or create a Part by name within a category."""
    part = Part.query.filter_by(name=name, category=category).first()
    if not part:
        part = Part(name=name, category=category)
        db.session.add(part)
        db.session.commit()
    return part

def download_and_store_image(image_url: str, build: Build) -> None:
    """Download image and save hero/thumbnail under static/uploads."""
    try:
        resp = requests.get(image_url, timeout=30)
        resp.raise_for_status()
        img = Image.open(io.BytesIO(resp.content)).convert("RGB")
    except Exception:
        return

    upload_dir = Path(app.config["UPLOAD_FOLDER"])
    upload_dir.mkdir(parents=True, exist_ok=True)
    hero_fn = upload_dir / f"build{build.id}_hero.jpg"
    thumb_fn = upload_dir / f"build{build.id}_thumb.jpg"

    img.save(hero_fn, format="JPEG")
    thumb = img.copy()
    thumb.thumbnail((300, 300))
    thumb.save(thumb_fn, format="JPEG")

    build.image_path = str(hero_fn.relative_to(Path(app.root_path)))
    build.thumb_path = str(thumb_fn.relative_to(Path(app.root_path)))

def import_catalog_from_csv(file_obj) -> List[Build]:
    """
    Process a Shopify CSV file and create draft builds in the database.

    Parameters:
        file_obj: a file-like object from request.files['csv_file']

    Returns:
        List of Build objects that were imported.
    """
    text = file_obj.read().decode("utf-8")
    reader = csv.DictReader(io.StringIO(text))
    # Group rows by Handle (product)
    groups = defaultdict(list)
    for row in reader:
        handle = row.get("Handle") or row.get("handle")
        if handle:
            groups[handle].append(row)

    imported_builds: List[Build] = []
    for handle, rows in groups.items():
        first_row = rows[0]
        title = first_row.get("Title") or "Unnamed Build"
        body_html = first_row.get("Body (HTML)", "")
       # Normalize tags: handle both list and comma-separated string
        tags_raw = product.get("tags", "")
        if isinstance(tags_raw, list):
            tags = [str(t).strip() for t in tags_raw if str(t).strip()]
        else:
            tags = [t.strip() for t in str(tags_raw).split(",") if t.strip()]

        # Determine tier and family
        tier_name = None
        family_name = None
        norm_tiers = {opt.lower(): opt for opt in TIER_OPTIONS}
        norm_fams = {opt.lower(): opt for opt in FAMILY_OPTIONS}
        for tag in tags:
            norm = _normalize_tag(tag)
            if not tier_name and norm in norm_tiers:
                tier_name = norm_tiers[norm]
            if not family_name and norm in norm_fams:
                family_name = norm_fams[norm]
            if tier_name and family_name:
                break

        with app.app_context():
            tier = find_or_create_category(tier_name, "Tier") if tier_name else None
            family = find_or_create_category(family_name, "Family") if family_name else None
            build = Build(name=title, status="Draft")
            if tier:
                build.tier = tier
            if family:
                build.family = family
            db.session.add(build)
            db.session.flush()  # assign ID

            # Parse specs
            specs = parse_spec_table(body_html)
            for key, value in specs.items():
                category_name = CATEGORY_MAPPING.get(key)
                if not category_name:
                    continue
                cat = find_or_create_category(category_name, "Part")
                part = find_or_create_part(value, cat)
                db.session.add(BuildPart(build=build, part=part, price_override=None))

            # Handle image (prefer Image Src or Variant Image)
            image_url = None
            for row in rows:
                image_url = row.get("Image Src") or row.get("Variant Image")
                if image_url:
                    break
            if image_url:
                download_and_store_image(image_url, build)

            db.session.commit()
            imported_builds.append(build)

    return imported_builds
