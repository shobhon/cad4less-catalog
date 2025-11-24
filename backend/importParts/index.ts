

'use strict';

// Lambda handler for POST /imports/apify/{category}
// This is a stub implementation that validates input and echoes it back.
// It is designed to fix CORS / network issues so the frontend can
// reliably receive a response from the backend.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'OPTIONS,POST',
};

exports.handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: '',
    };
  }

  const category =
    (event.pathParameters && event.pathParameters.category) || null;

  if (!category) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Missing category in path' }),
    };
  }

  let datasetId;

  try {
    const body = event.body ? JSON.parse(event.body) : {};
    datasetId = body.datasetId;

    if (!datasetId || typeof datasetId !== 'string') {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Missing or invalid datasetId' }),
      };
    }
  } catch (err) {
    console.error('Invalid JSON body for importParts:', err);
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Invalid JSON body' }),
    };
  }

  // Stubbed result for now: we just echo back the inputs.
  // Later this can be replaced with a real Apify call.
  const result = {
    status: 'stubbed',
    category,
    datasetId,
    itemCount: 0,
    items: [],
  };

  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify(result),
  };
};