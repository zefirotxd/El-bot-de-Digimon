import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * Lanza el runner de tests de Node sobre todos los *.test.ts del proyecto.
 *
 * `node --test` no acepta globs hasta la v21, y PowerShell no expande `**`.
 * Este script resuelve los ficheros y se los pasa explícitamente, así que
 * `npm test` funciona igual en Windows, Linux y macOS.
 */
const root = resolve(process.cwd(), 'src');

function findTests(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...findTests(full));
    else if (entry.endsWith('.test.ts')) found.push(full);
  }
  return found.sort();
}

const files = findTests(root);

if (files.length === 0) {
  console.error('No se encontró ningún fichero *.test.ts en src/');
  process.exit(1);
}

console.log(`Ejecutando ${files.length} fichero(s) de test:`);
for (const file of files) console.log(`  · ${relative(process.cwd(), file)}`);

const result = spawnSync(
  process.execPath,
  ['--import', 'tsx', '--test', ...files],
  { stdio: 'inherit', cwd: process.cwd() },
);

process.exit(result.status ?? 1);
