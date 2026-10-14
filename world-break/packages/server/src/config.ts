import { z } from 'zod';

const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(0).max(65535).default(3001),
  // Read server-side only. Absence means the deterministic fallback director is used.
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().optional(),
});
export type ServerConfig = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return EnvSchema.parse(env);
}
