// Vercel 진입점: Express + WebSocket 서버를 그대로 내보낸다. (로컬 실행은 `npm start`)
import { createApp } from './server/index.js';

const { server } = createApp();

export default server;
