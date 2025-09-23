import fs from 'fs';

export async function ensureDirs() {
  await fs.promises.mkdir('export', { recursive: true });
}
