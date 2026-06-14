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
