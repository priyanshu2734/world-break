import { loadConfig } from './config';
import { createGameServer } from './gateway';

const config = loadConfig();
const server = createGameServer({ abilityLab: config.ABILITY_LAB === '1', huntStage: config.HUNT_STAGE !== '0' });
const port = await server.listen(config.PORT);
console.log(`[world-break] server listening on :${port} (AI director: ${config.OPENAI_API_KEY ? 'OpenAI enabled' : 'deterministic fallback only'}; Ability Lab: ${config.ABILITY_LAB === '1' ? 'ON, open /?lab=1' : 'off'}; stage 1: ${config.HUNT_STAGE !== '0' ? 'salvage hunt' : 'tutorial'})`);
