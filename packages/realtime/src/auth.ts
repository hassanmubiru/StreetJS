// src/auth.ts
// Connection authentication (upgrade authFn) and channel authorization types.
//
// This module declares the `ChannelAuthorizer` used to gate Secured_Channels
// (Req 10). The upgrade `authFn` wiring is implemented in task 6.1; this
// scaffold establishes the exported typed surface.

import type { Member } from './facade.js';

/** Authorization rule for a Secured_Channel (Req 10.1, 10.2). */
export type ChannelAuthorizer = (
  ctx: { channel: string; member: Member | null; action: 'join' | 'broadcast' },
) => boolean | Promise<boolean>;
