import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

if (existsSync('.env')) { console.log('.env already exists; preserved.'); }
else { writeFileSync('.env', readFileSync('.env.example', 'utf8').replace('ENCRYPTION_KEY=', `ENCRYPTION_KEY=${randomBytes(32).toString('hex')}`)); console.log('Created .env with a new encryption key.'); }
