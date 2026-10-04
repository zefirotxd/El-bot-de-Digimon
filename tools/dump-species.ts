import { SPECIES } from '../src/game/species.js';
for (const [k, s] of Object.entries(SPECIES)) {
  const evo = s.evolution ? `-> ${s.evolution.to} @${s.evolution.level}` : '(forma final)';
  console.log(k.padEnd(18), s.tier.padEnd(9), s.attribute.padEnd(8), evo);
}
console.log('total:', Object.keys(SPECIES).length);
