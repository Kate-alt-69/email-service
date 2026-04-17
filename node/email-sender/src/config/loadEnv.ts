import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

let envLoaded = false;

export function loadServiceEnv(): void {
  if (envLoaded) return;

  const candidates = [
    path.resolve(__dirname, '../../../.env'),
    path.resolve(process.cwd(), '.env'),
  ];

  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue;
    dotenv.config({ path: envPath, override: false });
  }

  envLoaded = true;
}
