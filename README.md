# PC Build Manager

This repository contains a simple Flask application for managing and composing
prebuilt PC builds. The application provides an admin interface for selecting
components, assigning marketing tiers and processor families, uploading a
single image for each build, and saving the build through a Draft → Approve
→ Publish workflow. It also includes configuration for containerized
deployment with Docker and continuous delivery to AWS Elastic Beanstalk.

## Features

- Authentication using a single admin user (username/password)
- Management of component categories and parts
- Build composer with support for multiple component categories
- Editable pricing for each selected part
- Upload of a single image per build with automatic hero and thumbnail
- Draft, Approve, Publish workflow for builds
- Dockerfile and docker‑compose for local development
- Sample Elastic Beanstalk configuration and GitHub Actions workflow for CI/CD

## Local Development

1. **Clone the repository** and change into the project directory:

   ```sh
   git clone <your-repo-url>
   cd cad4less-catalog
   ```

2. **Create a `.env` file** by copying `.env.example` and updating values:

   ```sh
   cp .env.example .env
   # Edit .env to set a strong SECRET_KEY and your admin credentials
   ```

3. **Build and run the app using Docker Compose** (ensures dependencies are
   installed and the SQLite database lives in the container):

   ```sh
   docker-compose up --build
   ```

   The application will be available at <http://localhost:5000>.

4. **Initialize the database and create the admin user**. In a new shell run:

   ```sh
   docker-compose run --rm web flask db upgrade
   docker-compose run --rm web flask shell -c \
       "from app import db, User; u=User(username='$ADMIN_USERNAME'); u.set_password('$ADMIN_PASSWORD'); db.session.add(u); db.session.commit()"
   ```

   Replace `$ADMIN_USERNAME` and `$ADMIN_PASSWORD` with the values you
   configured in `.env`.

## Deployment to Elastic Beanstalk

The repository includes a `Dockerrun.aws.json` file for Elastic Beanstalk and a
`.github/workflows/deploy.yml` GitHub Actions workflow for automated CI/CD.

To deploy via Elastic Beanstalk:

1. **Create an ECR repository** for the Docker image (e.g. `prebuilt-pc-builds`).
2. **Create an Elastic Beanstalk application and environment** using the
   single Docker platform. Make note of the application and environment names.
3. **Set up GitHub secrets** in your repository for AWS credentials and EB
   configuration:

   - `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` – credentials for an IAM
     user with ECR and Elastic Beanstalk permissions.
   - `AWS_REGION` – your AWS region (e.g. `us-east-1`).
   - `AWS_ACCOUNT_ID` – your AWS account ID (for ECR image URIs).
   - `EB_APP_NAME` – the Elastic Beanstalk application name.
   - `EB_ENV_NAME` – the Elastic Beanstalk environment name.
   - `EB_S3_BUCKET` – an S3 bucket Elastic Beanstalk can use to store
     application versions.
4. Commit and push your code to the `main` branch. The GitHub Actions
   workflow will build the Docker image, push it to ECR, update the
   `Dockerrun.aws.json` with the new image tag, create a new application
   version, and deploy it to your environment.

Refer to the comments in `Dockerrun.aws.json`, `.ebextensions/01_env.config`, and
`.github/workflows/deploy.yml` for additional configuration details.
