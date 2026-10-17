import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/** Design rule (docs/DESIGN.md): the game is ENDLESS. No source file may model a last stage or an ending. */
const PACKAGES = fileURLToPath(new URL('../../', import.meta.url));
const FORBIDDEN: RegExp[] = [
  /\b(MAX_STAGES?|FINAL_STAGE|LAST_STAGE|lastStage|finalStage|maxStage|isLastStage|isFinalStage|totalStages)\b/,
  /you win|game complete|game over screen|no more stages|the end\b/i,
];

function sources(pkg: string): string[] {
  const root = join(PACKAGES, pkg, 'src');
  return readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.ts'))
    .map((f) => join(root, f));
}

describe('no code path treats any stage as the last', () => {
  const files = ['shared', 'server', 'client'].flatMap(sources);
  it('scans a meaningful number of source files', () => {
    expect(files.length).toBeGreaterThan(25);
  });
  it('contains no "final stage" constants and no ending/victory copy', () => {
    const hits: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      for (const re of FORBIDDEN) { const m = re.exec(text); if (m) hits.push(`${f}: ${m[0]}`); }
    }
    expect(hits).toEqual([]);
  });
});
