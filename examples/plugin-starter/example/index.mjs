// Minimal runnable example: instantiate the plugin and inspect its identity.
// Run after building: node example/index.mjs
import Plugin from '../dist/index.js';

const plugin = new Plugin();
console.log(`Loaded plugin: ${plugin.name}@${plugin.version}`);
// In a real app you register it with the host, which calls onLoad(app).
