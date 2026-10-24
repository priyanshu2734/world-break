import { loadConfig } from './config';
import { createGameServer } from './gateway';

const config = loadConfig();
const server = createGameServer({ abilityLab: config.ABILITY_LAB === '1', huntStage: config.HUNT_STAGE !== '0', escapeStages: config.ESCAPE_STAGES !== '0' });
const port = await server.listen(config.PORT);
console.log(`[world-break] server listening on :${port} (AI director: ${config.OPENAI_API_KEY ? 'OpenAI enabled' : 'deterministic fallback only'}; Ability Lab: ${config.ABILITY_LAB === '1' ? 'ON, open /?lab=1' : 'off'}; escape stages: ${config.ESCAPE_STAGES !== '0' ? 'ON (every stage is generated; /?rooms=1 and /?rooms=2 open the dev stages)' : 'off'}; stage 1: ${config.ESCAPE_STAGES !== '0' ? 'escape tutorial' : config.HUNT_STAGE !== '0' ? 'salvage hunt' : 'tutorial'})`);
