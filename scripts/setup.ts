/**
 * Asistente de configuración: te entrevista y arma tu agente sin tocar código.
 *
 *   npm run setup
 *
 * Te hace unas preguntas sobre tu negocio y escribe por vos:
 *   - config/agent.yaml  (personalidad + conocimiento del agente)
 *   - .env               (canal + credenciales)
 *
 * A diferencia de otros "generadores", NO inventa código: solo completa la
 * configuración. El agente ya está construido y probado; vos le das su identidad.
 */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { stringify } from 'yaml';

const TONES: Record<string, string> = {
  profesional: 'Profesional, claro y respetuoso.',
  amigable: 'Cercano y amigable, con calidez, sin ser informal de más.',
  vendedor: 'Persuasivo pero sin presionar: orientás la charla a que el cliente avance.',
  empatico: 'Empático: reconocés cómo se siente el cliente antes de responder.',
};

const CHANNELS = ['web', 'cloud-api', 'ghl', 'chatwoot', 'ycloud'];

async function main() {
  const rl = createInterface({ input: stdin, output: stdout });
  const ask = async (q: string, def = '') => {
    const a = (await rl.question(def ? `${q} [${def}]: ` : `${q}: `)).trim();
    return a || def;
  };

  console.log('\n  ✨ Configurá tu agente de WhatsApp — respondé y listo.\n');

  if (existsSync('config/agent.yaml') || existsSync('.env')) {
    const ok = (await ask('Ya hay config/.env. ¿Sobrescribir? (s/n)', 'n')).toLowerCase();
    if (ok !== 's' && ok !== 'si') {
      console.log('  Cancelado. No se tocó nada.\n');
      rl.close();
      return;
    }
  }

  const business = await ask('1/9 · Nombre de tu negocio', 'Mi Negocio');
  const whatDoes = await ask('2/9 · ¿A qué se dedica?', 'Vendemos productos y servicios');
  const purpose = await ask('3/9 · ¿Para qué querés el agente? (responder dudas, agendar, tomar pedidos, calificar leads)', 'responder dudas');
  const agentName = await ask('4/9 · Nombre del agente (el que ven tus clientes)', 'Asistente');
  const toneKey = await ask(`5/9 · Tono (${Object.keys(TONES).join(' / ')})`, 'amigable');
  const hours = await ask('6/9 · Horario de atención', 'Lunes a Viernes de 9 a 18 hs');

  console.log('\n7/9 · Datos que el agente debe saber (horarios, precios, políticas, FAQ).');
  console.log('      Escribí uno por línea. Enter vacío para terminar.\n');
  const knowledge: string[] = [];
  for (;;) {
    const line = (await rl.question(`      · dato ${knowledge.length + 1}: `)).trim();
    if (!line) break;
    knowledge.push(line);
  }
  if (knowledge.length === 0) knowledge.push(`Horario de atención: ${hours}.`);

  let channel = (await ask(`8/9 · Canal (${CHANNELS.join(' / ')})`, 'web')).toLowerCase();
  if (!CHANNELS.includes(channel)) channel = 'web';

  const openrouterKey = await ask('9/9 · Tu API key de OpenRouter (https://openrouter.ai/keys)', '');

  // Credenciales del canal (solo las mínimas; el resto se completan a mano).
  const channelVars: Record<string, string> = {};
  if (channel === 'cloud-api') {
    channelVars.META_ACCESS_TOKEN = await ask('   · META_ACCESS_TOKEN (Enter para dejar en blanco)', '');
    channelVars.META_PHONE_NUMBER_ID = await ask('   · META_PHONE_NUMBER_ID', '');
    channelVars.META_VERIFY_TOKEN = await ask('   · META_VERIFY_TOKEN (inventá uno)', 'verify-' + business.toLowerCase().replace(/\s+/g, '-'));
  } else if (channel === 'ghl') {
    channelVars.GHL_API_TOKEN = await ask('   · GHL_API_TOKEN', '');
    channelVars.GHL_LOCATION_ID = await ask('   · GHL_LOCATION_ID', '');
    channelVars.WEBHOOK_SECRET = await ask('   · WEBHOOK_SECRET (inventá uno largo)', '');
  }

  rl.close();

  // ── config/agent.yaml ───────────────────────────────────────
  const tone = TONES[toneKey] ?? TONES.amigable;
  const systemPrompt = [
    `Sos ${agentName}, el asistente de WhatsApp de ${business} (${whatDoes}).`,
    '',
    'Cómo hablás:',
    `- ${tone}`,
    '- Mensajes cortos, es WhatsApp. Una sola pregunta por mensaje.',
    '- Nunca digas que sos un bot, una IA ni un asistente virtual.',
    '',
    'Tu objetivo:',
    `- ${purpose}.`,
    '- Usá la herramienta search_knowledge para responder con la info del negocio.',
    '',
    `Horario de atención: ${hours}.`,
    '',
    'Qué NUNCA hacés:',
    '- Inventar datos. Si algo no sale de una herramienta ni del conocimiento, decilo',
    '  con honestidad y ofrecé conectar con una persona del equipo.',
  ].join('\n');

  const agentYaml = stringify({
    name: agentName,
    system_prompt: systemPrompt,
    knowledge,
    greeting: `¡Hola! 👋 Soy ${agentName}, de ${business}. ¿En qué te ayudo?`,
  });
  writeFileSync('config/agent.yaml', agentYaml);

  // ── .env ────────────────────────────────────────────────────
  const base = existsSync('.env.example') ? readFileSync('.env.example', 'utf8') : '';
  const overrides: Record<string, string> = {
    STORE: 'memory',
    CHANNEL_ADAPTER: channel,
    ...(openrouterKey ? { OPENROUTER_API_KEY: openrouterKey } : {}),
    ...channelVars,
  };
  writeFileSync('.env', applyEnv(base, overrides));

  console.log(`\n  ✅ Listo. Escribí config/agent.yaml y .env.\n`);
  console.log(`     Agente:  ${agentName} · Canal: ${channel}\n`);
  console.log('  Probalo ahora:');
  console.log(channel === 'web' ? '     npm run demo        (abre http://localhost:3000)' : '     npm run chat        (chat de prueba en la terminal)');
  console.log('\n  Editá config/agent.yaml cuando quieras afinar la personalidad o el conocimiento.\n');
}

/** Reemplaza (o agrega) las variables dadas en el texto de un .env. */
function applyEnv(text: string, overrides: Record<string, string>): string {
  let out = text;
  for (const [key, value] of Object.entries(overrides)) {
    const re = new RegExp(`^#?\\s*${key}=.*$`, 'm');
    if (re.test(out)) out = out.replace(re, `${key}=${value}`);
    else out += `\n${key}=${value}`;
  }
  return out;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
