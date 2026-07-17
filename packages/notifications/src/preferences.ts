// src/preferences.ts
// In-memory preference store: opt recipients in/out per channel and category.

import type { ChannelName, PreferenceStore } from './types.js';

/**
 * In-memory {@link PreferenceStore}. Channels are **enabled by default**; a
 * recipient can be opted out of a whole channel or of a specific
 * `channel:category` pair. Security/transactional categories can be marked
 * mandatory so they are never suppressed.
 */
export class InMemoryPreferenceStore implements PreferenceStore {
  private readonly disabledChannels = new Set<string>();
  private readonly disabledCategories = new Set<string>();
  private readonly mandatoryCategories = new Set<string>();

  private channelKey(recipientId: string, channel: ChannelName): string {
    return `${recipientId}\u0000${channel}`;
  }
  private categoryKey(recipientId: string, channel: ChannelName, category: string): string {
    return `${recipientId}\u0000${channel}\u0000${category}`;
  }

  /** Opt a recipient out of an entire channel. */
  disableChannel(recipientId: string, channel: ChannelName): this {
    this.disabledChannels.add(this.channelKey(recipientId, channel));
    return this;
  }

  /** Re-enable a previously disabled channel. */
  enableChannel(recipientId: string, channel: ChannelName): this {
    this.disabledChannels.delete(this.channelKey(recipientId, channel));
    return this;
  }

  /** Opt a recipient out of a specific category on a channel. */
  disableCategory(recipientId: string, channel: ChannelName, category: string): this {
    this.disabledCategories.add(this.categoryKey(recipientId, channel, category));
    return this;
  }

  /** Mark a category as mandatory (never suppressed, e.g. 'security'). */
  markMandatory(category: string): this {
    this.mandatoryCategories.add(category);
    return this;
  }

  async isEnabled(recipientId: string, channel: ChannelName, category?: string): Promise<boolean> {
    if (category !== undefined && this.mandatoryCategories.has(category)) return true;
    if (this.disabledChannels.has(this.channelKey(recipientId, channel))) return false;
    if (category !== undefined &&
        this.disabledCategories.has(this.categoryKey(recipientId, channel, category))) {
      return false;
    }
    return true;
  }
}

/** A {@link PreferenceStore} that always allows delivery (the default). */
export class AllowAllPreferences implements PreferenceStore {
  async isEnabled(): Promise<boolean> {
    return true;
  }
}
