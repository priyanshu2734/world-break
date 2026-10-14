import { loadConfig } from './config';
import { createGameServer } from './gateway';

const config = loadConfig();
const server = createGameServer();
const port = await server.listen(config.PORT);
console.log(`[world-break] server listening on :${port} (AI director: ${config.OPENAI_API_KEY ? 'OpenAI enabled' : 'deterministic fallback only'})`);
