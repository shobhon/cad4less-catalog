# Use a fuller base to avoid apt issues on arm64
FROM python:3.11

WORKDIR /app

# Make pip quiet and lightweight during build
ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_PROGRESS_BAR=off

# Copy deps and install
COPY requirements.txt .
RUN python -m pip install --upgrade pip && \
    pip install --progress-bar off -r requirements.txt

# Copy the app
COPY . .

EXPOSE 5000
CMD ["gunicorn", "-w", "4", "-b", "0.0.0.0:5000", "app:app"]