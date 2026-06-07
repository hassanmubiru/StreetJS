// packages/edge/src/index.ts
// Public API for @streetjs/edge — the Street edge-runtime adapter.

export { handleEdgeRequest } from './adapter.js';
export { createLambdaHandler, eventToRequest, responseToResult } from './lambda.js';
export type { ApiGatewayProxyEvent, ApiGatewayProxyResult } from './lambda.js';
export { createAzureHandler, azureRequestToRequest, responseToAzure } from './azure.js';
export type { AzureHttpRequest, AzureHttpResponseInit } from './azure.js';
export { createGcfHandler, gcfRequestToRequest } from './gcf.js';
export type { GcfRequest, GcfResponse } from './gcf.js';
export { EdgeRuntimeStub } from './stubs.js';
export type { EdgeRequest, EdgeResponse } from './stubs.js';

// Re-export the edge-runtime error from core for convenience.
export { FeatureUnavailableInEdgeRuntimeError } from '@streetjs/core';
