// src/tests/plugin.test.ts
// Unit tests for EventsPlugin: onLoad constructs the facade, wires the health
// check + metrics against the app's registries, runs the startup register hook
// (plugins register listeners during startup), exposes the facade, and onUnload
// closes gracefully.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HealthCheckRegistry, MetricsRegistry } from 'streetjs';
import type { SandboxedApp } from 'streetjs';

import { EventsPlugin } from '../plugin.js';
import type { Events } from '../facade.js';
import {
  EVENTS_HEALTH_CHECK_NAME,
  EVENTS_PUBLISHED_METRIC,
  EVENTS_LISTENERS_METRIC,
} from '../observability.js';

interface AppEvents {
  'user.created': { id: string };
}

function fakeApp(): SandboxedApp {
  return { use() {}, on() {} } as unknown as SandboxedApp;
}

test('onLoad constructs the facade, registers observability, and runs the startup register hook', async () => {
  const health = new HealthCheckRegistry();
  const metrics = new MetricsRegistry();

  const received: string[] = [];
  let captured: Events<AppEvents> | undefined;
  const plugin = new EventsPlugin<AppEvents>({
    health,
    metrics,
    register: (events) => {
      // Plugins/modules subscribe their listeners during startup.
      captured = events;
      events.on('user.created', (u) => {
        received.push(u.id);
      });
    },
  });

  assert.equal(plugin.events, undefined, 'no facade before load');
  await plugin.onLoad(fakeApp());

  // The getter exposes the same facade the register hook received.
  assert.notEqual(plugin.events, undefined, 'facade constructed after load');
  const events = captured;
  if (!events) {
    throw new Error('register hook should have received the facade');
  }

  // The startup-registered listener receives events.
  await events.publish('user.created', { id: 'u1' });
  assert.deepEqual(received, ['u1']);

  // Health check registered and up.
  const live = await health.runLiveness();
  assert.equal(live.checks[EVENTS_HEALTH_CHECK_NAME]?.status, 'up');

  // Metrics registered and advancing.
  assert.equal(metrics.has(EVENTS_PUBLISHED_METRIC), true);
  assert.equal(metrics.has(EVENTS_LISTENERS_METRIC), true);

  await plugin.onUnload(fakeApp());
  assert.equal(plugin.events, undefined, 'facade cleared after unload');
});

test('onLoad is idempotent — a second load reuses the same facade', async () => {
  const plugin = new EventsPlugin<AppEvents>();
  await plugin.onLoad(fakeApp());
  const first = plugin.events;
  await plugin.onLoad(fakeApp());
  assert.equal(plugin.events, first, 'facade identity unchanged on a second onLoad');
  await plugin.onUnload(fakeApp());
});

test('onUnload is a no-op when never loaded', async () => {
  const plugin = new EventsPlugin<AppEvents>();
  await assert.doesNotReject(() => plugin.onUnload(fakeApp()));
  assert.equal(plugin.events, undefined);
});
