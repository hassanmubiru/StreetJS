/**
 * @streetjs/notion — the StreetJS Notion connector.
 *
 * A typed Notion API client built on `@streetjs/integrations` (pages,
 * databases, blocks, search) with the required `Notion-Version` header, plus
 * `verifyNotionWebhook` for validating the inbound `X-Notion-Signature`
 * HMAC-SHA256 header.
 *
 * ```ts
 * import { NotionClient } from '@streetjs/notion';
 *
 * const notion = new NotionClient({ token: process.env.NOTION_TOKEN! });
 * const page = await notion.createPage({
 *   parent: { database_id: dbId },
 *   properties: { Name: { title: [{ text: { content: 'Deploy failed' } }] } },
 * });
 * ```
 */

export { NotionClient } from './client.js';
export type {
  NotionClientOptions,
  NotionObject,
  NotionList,
  CreatePageInput,
  QueryDatabaseInput,
  SearchInput,
} from './client.js';

export { verifyNotionWebhook } from './webhook.js';
export type { NotionVerifyInput } from './webhook.js';
