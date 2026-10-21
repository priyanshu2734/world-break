import { z } from 'zod';

const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(0).max(65535).default(3001),
  // Read server-side only. Absence means the deterministic fallback director is used.
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().optional(),
  // P3B dev flag. '1' lets a client create an Ability Lab room (`/?lab=1`). Anything else = off.
  ABILITY_LAB: z.enum(['0', '1']).optional(),
  // P3C: stage 1 is the salvage hunt. Default ON for the dev server; '0' restores the tutorial as stage 1.
  HUNT_STAGE: z.enum(['0', '1']).optional(),
  // P3D: escape-room stages. Default ON for the dev server; '0' restores the previous stage 1 and generator behaviour (the multi-room demo is then refused).
  ESCAPE_STAGES: z.enum(['0', '1']).optional(),
});
export type ServerConfig = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return EnvSchema.parse(env);
}
