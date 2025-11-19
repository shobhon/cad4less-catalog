# CAD4Less Catalog Configurator

This repository contains the initial scaffold for the CAD4Less custom PC
configuration and catalog application. The goal of this project is to enable
CAD4Less administrators to configure custom PC builds from real‑time priced
components, validate compatibility, calculate profit margins, and publish the
resulting build to Shopify for sale on the `cad4less.com` website.

## Structure

This project is divided into two top‑level directories:

* **backend/**: Contains the serverless backend code, including AWS Lambda
  functions and an AWS SAM template to define the required AWS resources.
* **frontend/**: Placeholder for the eventual web UI. At this stage it
  includes a very simple HTML file as a stand‑in until a full React/Next.js
  frontend is implemented.

## Backend

The backend uses AWS Lambda functions orchestrated through API Gateway and
DynamoDB. The `template.yaml` file defines the resources to deploy. The
functions are only stubs at this point but illustrate how the application
will eventually be structured.

### Key functions

* `fetchParts.js`: Accepts category and vendor parameters and is intended to
  fetch parts lists from external sources (e.g. Amazon, Newegg) in real time.
  It also implements a simple in‑memory cache with an expiry to reduce
  repeated external requests.
* `compatibility.js`: Contains logic for determining compatibility between
  selected components based on their specifications. In a production
  implementation this would query DynamoDB for stored compatibility rules and
  apply a strict filtering algorithm.
* `build.js`: Handles build creation by validating a set of selected parts,
  computing the total cost and applying margins, and generating the data
  required to create a product on Shopify (or export as CSV).
* `export.js`: Generates a CSV export of a completed build. It takes
  a JSON body containing the selected parts and returns a `text/csv`
  response with a header row and one line per part. This allows the
  administrator to download a build in CSV format for record‑keeping or
  manual import into Shopify.

### Deployment

This repository is designed to be deployed with the AWS Serverless
Application Model (SAM). To deploy locally you would need to install
`aws-sam-cli` and run `sam build` followed by `sam deploy`. Since this
environment does not have AWS CLI configured, deployment steps are left
commented in `template.yaml` as a guide.

## Frontend

The frontend directory contains a placeholder HTML file (`index.html`) to
demonstrate where the user interface will live. In a production system this
would be replaced with a React or Next.js application served from S3 and
CloudFront.

## Next Steps

1. Implement actual API integrations in `fetchParts.js` for your chosen
   vendors. This may involve using SDKs or web scraping depending on the
   available services.
2. Flesh out the compatibility engine in `compatibility.js` to cover all
   relevant rules (CPU socket matching, RAM speed support, PSU wattage, case
   and cooling clearances, etc.) and integrate with a DynamoDB table of
   specification data.
3. Expand the build logic in `build.js` to handle margin rules, vendor
   preference selection, and generation of product data (including the
   composite image) before pushing to Shopify or exporting CSV.
4. Replace the simple HTML frontend with a modern framework (e.g. React) and
   connect it to the backend via API Gateway endpoints.
5. After implementing the full backend, update `template.yaml` to define
   the necessary DynamoDB tables, IAM roles, and API Gateway routes, then
   deploy using AWS SAM or the Serverless Framework.
