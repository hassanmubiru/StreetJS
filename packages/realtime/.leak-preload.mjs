// Preloaded diagnostic: after the test run stalls, dump the surviving handles
// that keep the event loop alive, then force-exit so we can read them.
setTimeout(() => {
  try {
    const info = process.getActiveResourcesInfo();
    // Also introspect handles for more detail where available.
    const handles = typeof process._getActiveHandles === 'function' ? process._getActiveHandles() : [];
    const detail = handles.map((h) => {
      const c = h?.constructor?.name ?? typeof h;
      const extra = h && h.remoteAddress ? `${h.remoteAddress}:${h.remotePort}` : (h && h._host ? h._host : '');
      return extra ? `${c}(${extra})` : c;
    });
    console.log('[leak-preload] getActiveResourcesInfo:', JSON.stringify(info));
    console.log('[leak-preload] _getActiveHandles:', JSON.stringify(detail));
  } catch (e) {
    console.log('[leak-preload] introspection error:', e?.message);
  }
  process.exit(99);
}, 10000).unref();
