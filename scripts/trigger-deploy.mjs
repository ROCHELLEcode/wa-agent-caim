/**
 * Dispara un redeploy en Coolify de la app ya existente (caim-bot) y espera
 * a que termine. A diferencia de scripts/deploy-coolify.ts (que provisiona
 * todo desde cero: claves SSH, proyecto, app), esto asume que la app YA
 * existe y solo pide "volvé a desplegar el último commit de main".
 *
 * Requiere en el .env: COOLIFY_URL, COOLIFY_API_TOKEN, COOLIFY_APP_UUID.
 *
 *   node scripts/trigger-deploy.mjs
 */
import { readFileSync } from 'node:fs';

function readEnv() {
  const out = {};
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}

const env = readEnv();
for (const k of ['COOLIFY_URL', 'COOLIFY_API_TOKEN', 'COOLIFY_APP_UUID']) {
  if (!env[k]) {
    console.error(`Falta ${k} en el .env`);
    process.exit(1);
  }
}

const COOLIFY = env.COOLIFY_URL.replace(/\/+$/, '');
const HEADERS = { Authorization: `Bearer ${env.COOLIFY_API_TOKEN}`, Accept: 'application/json' };

async function main() {
  const res = await fetch(`${COOLIFY}/api/v1/deploy?uuid=${env.COOLIFY_APP_UUID}`, { method: 'POST', headers: HEADERS });
  const body = await res.json();
  if (!res.ok) {
    console.error(`Error al disparar el deploy (${res.status}):`, body);
    process.exit(1);
  }
  const deploymentUuid = body.deployments?.[0]?.deployment_uuid;
  console.log(`Deploy encolado: ${deploymentUuid}`);
  if (!deploymentUuid) process.exit(0);

  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const d = await fetch(`${COOLIFY}/api/v1/deployments/${deploymentUuid}`, { headers: HEADERS }).then((r) => r.json());
    console.log(`  estado: ${d.status}`);
    if (['finished', 'failed', 'error', 'cancelled'].includes(d.status)) {
      if (d.status !== 'finished') process.exit(1);
      console.log(`✓ Deploy terminado (commit ${d.commit}).`);
      return;
    }
  }
  console.error('Timeout esperando el deploy (seguí mirando en Coolify).');
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
