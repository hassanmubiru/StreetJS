// packages/cli/src/commands/add.ts
// `street add <feature>` — adds a capability to the current project. Core
// features (auth, postgres, websocket) are built into `streetjs` and only need
// wiring; external features map to an `@streetjs/*` package that is installed.
//
//   street add ai            # installs @streetjs/ai + prints wiring snippet
//   street add postgres      # built into core; prints wiring snippet
//   street add ai --dry-run  # show the plan without installing

import { spawn } from 'node:child_process';
import type { CliContext } from '../index.js';

interface FeatureSpec {
  /** npm packages to install (empty = built into streetjs core). */
  packages: string[];
  /** A short wiring snippet shown after install. */
  snippet: string;
  description: string;
}

/** Friendly feature name → install plan + wiring guidance. */
export const FEATURES: Record<string, FeatureSpec> = {
  auth: {
    packages: [],
    description: 'JWT + session authentication (built into streetjs core)',
    snippet: "import { JwtService, SessionManager } from 'streetjs';",
  },
  postgres: {
    packages: [],
    description: 'PostgreSQL via the native wire driver (built into streetjs core)',
    snippet: "import { PgPool } from 'streetjs';\nconst pool = new PgPool({ host, port, user, password, database });",
  },
  websocket: {
    packages: [],
    description: 'WebSocket server + channel hub (built into streetjs core)',
    snippet: "import { StreetWebSocketServer, ChannelHub } from 'streetjs';",
  },
  redis: {
    packages: [],
    description: 'Redis client — cache, pub/sub, single-node or Cluster (built into streetjs core)',
    snippet:
      "import { RedisClient } from 'streetjs';\n" +
      "const redis = new RedisClient({ host: '127.0.0.1', port: 6379 });\n" +
      "// High availability: import { RedisClusterClient } from 'streetjs'; new RedisClusterClient({ nodes: [...] });",
  },
  search: {
    packages: ['@streetjs/search'],
    description: 'Provider-based search (in-memory, Postgres FTS, Meilisearch, Elasticsearch)',
    snippet: "import { SearchService } from '@streetjs/search';\nconst search = new SearchService();",
  },
  ai: {
    packages: ['@streetjs/ai'],
    description: 'LLM chat, embeddings, RAG, tool-calling (OpenAI/Anthropic/Ollama)',
    snippet: "import { OpenAiProvider, RagPipeline } from '@streetjs/ai';",
  },
  commerce: {
    packages: ['@streetjs/commerce'],
    description: 'Products, inventory (no-oversell), carts, orders, payments',
    snippet: "import { CommerceService } from '@streetjs/commerce';",
  },
  storage: {
    packages: ['@streetjs/storage'],
    description: 'File storage with signed URLs (local, Postgres, GCS, Azure)',
    snippet: "import { StorageService } from '@streetjs/storage';",
  },
  admin: {
    packages: ['@streetjs/admin'],
    description: 'User/role management, RBAC, audit log',
    snippet: "import { AdminService } from '@streetjs/admin';",
  },
  social: {
    packages: ['@streetjs/social-users', '@streetjs/social-feed', '@streetjs/social-comments', '@streetjs/social-notifications'],
    description: 'Follow graph, feeds, comments, notifications',
    snippet: "import { FollowService } from '@streetjs/social-users';",
  },
  nats: {
    packages: ['@streetjs/plugin-nats'],
    description: 'NATS publish/subscribe messaging (dependency-free protocol client)',
    snippet: "import { NatsPlugin } from '@streetjs/plugin-nats';\nconst nats = new NatsPlugin({ host: '127.0.0.1', port: 4222 });",
  },
  kafka: {
    packages: ['@streetjs/plugin-kafka'],
    description: 'Apache Kafka streaming (wraps the dependency-free core Kafka client)',
    snippet: "import { KafkaPlugin } from '@streetjs/plugin-kafka';\nconst kafka = new KafkaPlugin({ brokers: ['127.0.0.1:9092'] });",
  },
  rabbitmq: {
    packages: ['@streetjs/plugin-rabbitmq'],
    description: 'RabbitMQ messaging (wraps the dependency-free core AMQP 0-9-1 transport)',
    snippet: "import { RabbitMqPlugin } from '@streetjs/plugin-rabbitmq';\nconst mq = new RabbitMqPlugin({ host: '127.0.0.1', port: 5672 });",
  },
  'postgres-plugin': {
    packages: ['@streetjs/plugin-postgres'],
    description: 'PostgreSQL pool as a signed plugin (wraps the native core PgPool)',
    snippet: "import { PostgresPlugin } from '@streetjs/plugin-postgres';\nconst pg = new PostgresPlugin({ host: '127.0.0.1', port: 5432, user, password, database });",
  },
  mysql: {
    packages: ['@streetjs/plugin-mysql'],
    description: 'MySQL/MariaDB pool (wraps the native, dependency-free core driver)',
    snippet: "import { MysqlPlugin } from '@streetjs/plugin-mysql';\nconst mysql = new MysqlPlugin({ host: '127.0.0.1', user, password, database });",
  },
  paypal: {
    packages: ['@streetjs/plugin-paypal'],
    description: 'PayPal Orders v2 (dependency-free HTTPS client)',
    snippet: "import { PayPalPlugin } from '@streetjs/plugin-paypal';\nconst paypal = new PayPalPlugin({ clientId, clientSecret, environment: 'sandbox' });",
  },
  openai: {
    packages: ['@streetjs/plugin-openai'],
    description: 'OpenAI chat + embeddings (dependency-free HTTPS client)',
    snippet: "import { OpenAiPlugin } from '@streetjs/plugin-openai';\nconst openai = new OpenAiPlugin({ apiKey: process.env.OPENAI_API_KEY });",
  },
  clerk: {
    packages: ['@streetjs/plugin-clerk'],
    description: 'Clerk identity backend API (dependency-free HTTPS client)',
    snippet: "import { ClerkPlugin } from '@streetjs/plugin-clerk';\nconst clerk = new ClerkPlugin({ secretKey: process.env.CLERK_SECRET_KEY });",
  },
  supabase: {
    packages: ['@streetjs/plugin-supabase'],
    description: 'Supabase PostgREST data API (dependency-free HTTPS client)',
    snippet: "import { SupabasePlugin } from '@streetjs/plugin-supabase';\nconst sb = new SupabasePlugin({ url: process.env.SUPABASE_URL, apiKey: process.env.SUPABASE_KEY });",
  },
  firebase: {
    packages: ['@streetjs/plugin-firebase'],
    description: 'Firebase Auth (Identity Toolkit) REST (dependency-free HTTPS client)',
    snippet: "import { FirebasePlugin } from '@streetjs/plugin-firebase';\nconst fb = new FirebasePlugin({ apiKey: process.env.FIREBASE_API_KEY });",
  },
  mongodb: {
    packages: ['@streetjs/plugin-mongodb'],
    description: 'MongoDB (dependency-free BSON + OP_MSG + SCRAM-SHA-256 client)',
    snippet: "import { MongoDbPlugin } from '@streetjs/plugin-mongodb';\nconst mongo = new MongoDbPlugin({ host: '127.0.0.1', port: 27017, database: 'app' });",
  },
};

export class AddCommand {
  async execute(ctx: CliContext): Promise<void> {
    const feature = ctx.args.positional[0];
    if (!feature) {
      console.error('[street] Usage: street add <feature>');
      console.error(`[street] Available features: ${Object.keys(FEATURES).join(', ')}`);
      process.exitCode = 1;
      return;
    }

    const spec = FEATURES[feature];
    if (!spec) {
      console.error(`[street] Unknown feature "${feature}".`);
      console.error(`[street] Available features: ${Object.keys(FEATURES).join(', ')}`);
      process.exitCode = 1;
      return;
    }

    const dryRun = Boolean(ctx.args.flags['dry-run']);
    console.log(`[street] add ${feature} — ${spec.description}`);

    if (spec.packages.length === 0) {
      console.log('[street] This feature is built into streetjs core; no install needed.');
    } else {
      console.log(`[street] Packages: ${spec.packages.join(', ')}`);
      if (dryRun) {
        console.log(`[street] (dry-run) would run: npm install ${spec.packages.join(' ')}`);
      } else {
        await this.npmInstall(spec.packages, ctx.cwd);
        console.log('[street] Installed.');
      }
    }

    console.log('\n[street] Wiring snippet:');
    console.log(spec.snippet.split('\n').map((l) => '  ' + l).join('\n'));
    console.log('');
  }

  private npmInstall(packages: string[], cwd: string): Promise<void> {
    return new Promise((resolvePromise, reject) => {
      const child = spawn('npm', ['install', ...packages], { cwd, stdio: 'inherit' });
      child.on('error', reject);
      child.on('exit', (code) => (code === 0 ? resolvePromise() : reject(new Error(`npm install exited ${code}`))));
    });
  }
}
