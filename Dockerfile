# Use an official Python runtime as a parent image
FROM python:3.11-slim

# Set environment variables
ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# Set the working directory
WORKDIR /app

# Install system dependencies required for Pillow
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libjpeg-dev \
    zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy application requirements and install them
COPY requirements.txt ./
RUN pip install -r requirements.txt

# Copy the application code
COPY . .

# Expose port 5000 for the Flask app
EXPOSE 5000

# Default command to run the Flask application using Gunicorn
CMD ["gunicorn", "-w", "4", "-b", "0.0.0.0:5000", "app:app"]