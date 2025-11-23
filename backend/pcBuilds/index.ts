
import { DynamoDB } from 'aws-sdk';
import { randomUUID } from 'crypto';

const docClient = new DynamoDB.DocumentClient();
const TABLE_NAME = process.env.BUILDS_TABLE_NAME || '';

type PcBuildStatus = 'draft' | 'ready' | 'published';

export interface PcBuild {
  buildId: string;
  name: string;
  profileType?: 'Economy' | 'Standard' | 'Premium' | 'AI';
  status: PcBuildStatus;
  createdAt: string;
  updatedAt: string;
  // later: parts, totals, benchmark info, etc.
}

const defaultHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'OPTIONS,GET,POST,PUT,DELETE',
};

const respond = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: defaultHeaders,
  body: JSON.stringify(body),
});

const parseBody = (body: string | null): any => {
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
};

export const handler = async (event: any) => {
  const method = event.httpMethod;
  const buildId: string | undefined = event.pathParameters?.buildId;

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: defaultHeaders,
      body: '',
    };
  }

  if (!TABLE_NAME) {
    return respond(500, { message: 'BUILDS_TABLE_NAME environment variable is not set' });
  }

  try {
    if (method === 'GET' && !buildId) {
      // List all builds
      const result = await docClient
        .scan({
          TableName: TABLE_NAME,
        })
        .promise();

      const items = (result.Items || []) as PcBuild[];
      return respond(200, { items });
    }

    if (method === 'POST' && !buildId) {
      // Create new build
      const data = parseBody(event.body);
      const now = new Date().toISOString();

      if (!data.name || typeof data.name !== 'string') {
        return respond(400, { message: 'Field "name" is required' });
      }

      const item: PcBuild = {
        buildId: randomUUID(),
        name: data.name,
        profileType: data.profileType,
        status: 'draft',
        createdAt: now,
        updatedAt: now,
      };

      await docClient
        .put({
          TableName: TABLE_NAME,
          Item: item,
        })
        .promise();

      return respond(201, item);
    }

    if (method === 'GET' && buildId) {
      // Get single build
      const result = await docClient
        .get({
          TableName: TABLE_NAME,
          Key: { buildId },
        })
        .promise();

      if (!result.Item) {
        return respond(404, { message: 'Build not found' });
      }

      return respond(200, result.Item as PcBuild);
    }

    if (method === 'PUT' && buildId) {
      // Update build (simple merge update)
      const data = parseBody(event.body);
      const now = new Date().toISOString();

      const existing = await docClient
        .get({
          TableName: TABLE_NAME,
          Key: { buildId },
        })
        .promise();

      if (!existing.Item) {
        return respond(404, { message: 'Build not found' });
      }

      const updated: PcBuild = {
        ...(existing.Item as PcBuild),
        ...data,
        buildId, // ensure primary key is not changed
        updatedAt: now,
      };

      await docClient
        .put({
          TableName: TABLE_NAME,
          Item: updated,
        })
        .promise();

      return respond(200, updated);
    }

    if (method === 'DELETE' && buildId) {
      // Delete build
      await docClient
        .delete({
          TableName: TABLE_NAME,
          Key: { buildId },
        })
        .promise();

      return respond(204, {});
    }

    return respond(404, { message: 'Route not found' });
  } catch (err: any) {
    console.error('PcBuildsFunction error', err);
    return respond(500, {
      message: 'Internal server error',
      error: err?.message || 'Unknown error',
    });
  }
};