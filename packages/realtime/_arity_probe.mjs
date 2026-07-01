import { ChannelHub, StreetSocket, StreetWebSocketServer } from 'streetjs';

function arity(proto, names) {
  return names.map((n) => {
    const d = Object.getOwnPropertyDescriptor(proto, n);
    if (!d) return n + ':MISSING';
    if (typeof d.value === 'function') return n + ':fn:' + d.value.length;
    if (typeof d.get === 'function') return n + ':getter';
    return n + ':other';
  });
}

console.log('HUB', arity(ChannelHub.prototype, ['join', 'leave', 'disconnect', 'bind', 'publish', 'presence', 'isPresent', 'memberCount', 'connectionCount', 'setTyping', 'typingMembers', 'channelNames']));
console.log('HUB.ctor', ChannelHub.length);
console.log('WSS', arity(StreetWebSocketServer.prototype, ['attach', 'attachProtocol', 'broadcast', 'close', 'connectionCount']));
console.log('WSS.ctor', StreetWebSocketServer.length);
console.log('SOCK', arity(StreetSocket.prototype, ['onClose', 'on', 'off', 'emit', 'close', 'closed', 'readyState']));
console.log('SOCK.ctor', StreetSocket.length);
