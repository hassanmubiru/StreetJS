import 'reflect-metadata';
import { streetApp } from 'streetjs';
import { StreetWebSocketServer } from 'streetjs/websocket';
const app = streetApp({ port: 3000 });
const wss = new StreetWebSocketServer({} as any);
