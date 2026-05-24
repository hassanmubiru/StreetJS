// src/cache/lru.ts
// LRU cache with TTL, bounded entry count, and periodic sweep.
export class LruCache {
    map = new Map();
    maxEntries;
    ttlMs;
    head = null; // most recently used
    tail = null; // least recently used
    sweepTimer;
    constructor(options) {
        if (options.maxEntries < 1)
            throw new Error('maxEntries must be >= 1');
        this.maxEntries = options.maxEntries;
        this.ttlMs = options.ttlMs;
        this.sweepTimer = setInterval(() => this._sweepExpired(), Math.min(this.ttlMs / 2, 60_000));
        this.sweepTimer.unref();
    }
    get(key) {
        const strKey = String(key);
        const entry = this.map.get(strKey);
        if (!entry)
            return undefined;
        if (Date.now() > entry.expiresAt) {
            this._remove(entry);
            return undefined;
        }
        // Move to head (most recently used)
        this._moveToHead(entry);
        return entry.value;
    }
    set(key, value) {
        const strKey = String(key);
        const existing = this.map.get(strKey);
        if (existing) {
            existing.value = value;
            existing.expiresAt = Date.now() + this.ttlMs;
            this._moveToHead(existing);
            return;
        }
        const entry = {
            key: strKey,
            value,
            expiresAt: Date.now() + this.ttlMs,
            prev: null,
            next: this.head,
        };
        this.map.set(strKey, entry);
        if (this.head)
            this.head.prev = entry;
        this.head = entry;
        if (!this.tail)
            this.tail = entry;
        // Evict LRU if over limit
        if (this.map.size > this.maxEntries) {
            this._evictTail();
        }
    }
    delete(key) {
        const strKey = String(key);
        const entry = this.map.get(strKey);
        if (!entry)
            return false;
        this._remove(entry);
        return true;
    }
    has(key) {
        const strKey = String(key);
        const entry = this.map.get(strKey);
        if (!entry)
            return false;
        if (Date.now() > entry.expiresAt) {
            this._remove(entry);
            return false;
        }
        return true;
    }
    clear() {
        this.map.clear();
        this.head = null;
        this.tail = null;
    }
    get size() { return this.map.size; }
    _moveToHead(entry) {
        if (entry === this.head)
            return;
        this._detach(entry);
        entry.next = this.head;
        entry.prev = null;
        if (this.head)
            this.head.prev = entry;
        this.head = entry;
        if (!this.tail)
            this.tail = entry;
    }
    _evictTail() {
        if (!this.tail)
            return;
        this._remove(this.tail);
    }
    _remove(entry) {
        this._detach(entry);
        this.map.delete(entry.key);
    }
    _detach(entry) {
        if (entry.prev)
            entry.prev.next = entry.next;
        else
            this.head = entry.next;
        if (entry.next)
            entry.next.prev = entry.prev;
        else
            this.tail = entry.prev;
        entry.prev = null;
        entry.next = null;
    }
    _sweepExpired() {
        const now = Date.now();
        for (const [, entry] of this.map) {
            if (now > entry.expiresAt) {
                this._remove(entry);
            }
        }
    }
    destroy() {
        clearInterval(this.sweepTimer);
        this.clear();
    }
}
//# sourceMappingURL=lru.js.map