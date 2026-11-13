import type OpenAI from 'openai';
import { env } from '../env.js';
import { logger } from '../logger.js';
import type { Contact, Conversation, ConversationStore, HistoryMessage } from '../memory/store.js';
import type { AgentConfig } from '../config.js';
import type { MediaItem } from '../channels/types.js';
import { llm } from './llm.js';
import { buildSystemPrompt } from './prompt.js';
import { sanitizeReply } from './sanitize.js';
import { defaultTools, type Tool, type ToolContext } from './tools/index.js';
import { mostrarSeccion } from './tools/examples/mostrarSeccion.js';

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type ToolCall = OpenAI.Chat.Completions.ChatCompletionMessageToolCall;

export interface RunAgentInput {
  store: ConversationStore;
  conversation: Conversation;
  contact: Contact;
  userText: string | null;
  config: AgentConfig;
  tools?: Tool[];
  instruction?: string;
}

export interface AgentResult {
  reply: string | null;
  toolsUsed: string[];
  media: MediaItem[];
}

export async function runAgent(input: RunAgentInput): Promise<AgentResult> {
  const { store, conversation, contact, userText, config } = input;
  const tools = input.tools ?? defaultTools;

  if (userText) {
    await store.appendMessage(conversation.id, { role: 'user', content: userText });
  }

  const history = await store.getHistory(conversation.id, env.AGENT_HISTORY_LIMIT);

  const ctx: ToolContext = {
    contactId: contact.id,
    conversationId: conversation.id,
    contactName: contact.name,
    store,
    media: [],
    alreadySent: computeAlreadySent(history),
  };

  // Pedido de info totalmente genérico ("info", "catálogo", "qué modelos
  // tienen", sin ningún número ni pista de tamaño): el system_prompt ya le
  // pide al modelo que acá llame a mostrar_seccion("pequenos") y responda
  // con un texto fijo, pero en la práctica esa instrucción no siempre se
  // sigue — alguna vez el modelo termina mandando un solo modelo (ej. el más
  // chico) en vez del panorama completo. Para un pedido así de inequívoco no
  // hace falta depender del criterio del modelo: se resuelve acá mismo,
  // siempre igual (mismo texto y fotos que se le pide al modelo en el
  // system_prompt, para los casos que esto no llegue a interceptar).
  if (userText && esPedidoGenericoDeInfo(userText)) {
    const resultado = await mostrarSeccion.run({ seccion: 'pequenos' }, ctx);
    const toolCallId = 'auto-info-generica';
    await store.appendMessage(conversation.id, {
      role: 'assistant',
      content: null,
      toolCalls: [
        { id: toolCallId, type: 'function', function: { name: 'mostrar_seccion', arguments: '{"seccion":"pequenos"}' } },
      ],
    });
    await store.appendMessage(conversation.id, {
      role: 'tool',
      content: JSON.stringify(resultado),
      toolCallId,
    });

    const saludo = contact.name ? `¡Hola, ${contact.name}!` : '¡Hola!';
    const reply = sanitizeReply(
      `${saludo} Estos son nuestros modelos pequeños. También contamos con modelos de 192 y 256 huevos ` +
        'en la línea PIEDRA, y desde 120 huevos hasta 1056 huevos en los modelos de metal semi industriales. ' +
        'Dígame en cuál está interesado para darle más información.',
    );
    await store.appendMessage(conversation.id, { role: 'assistant', content: reply, toolCalls: null });
    return { reply, toolsUsed: ['mostrar_seccion'], media: ctx.media };
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: buildSystemPrompt({ config, contactName: contact.name }) },
    ...pruneOrphanToolCalls(toChat(history)),
    ...(input.instruction ? [{ role: 'system' as const, content: input.instruction }] : []),
  ];

  const toolDefs = tools.map((t) => t.definition);
  const toolMap = new Map(tools.map((t) => [t.definition.function.name, t]));
  const toolsUsed: string[] = [];

  for (let i = 0; i < env.AGENT_MAX_TOOL_ITERATIONS; i++) {
    const completion = await llm.chat.completions.create({
      model: env.LLM_MODEL,
      messages,
      ...(toolDefs.length ? { tools: toolDefs } : {}),
      max_tokens: env.LLM_MAX_TOKENS,
      temperature: env.LLM_TEMPERATURE,
    });

    const choice = completion.choices[0];
    if (!choice) {
      logger.error({ completion }, 'el modelo no devolvió ninguna opción');
      return { reply: null, toolsUsed, media: ctx.media };
    }

    const message = choice.message;
    const toolCalls = message.tool_calls ?? [];

    await store.appendMessage(conversation.id, {
      role: 'assistant',
      content: message.content,
      toolCalls: toolCalls.length > 0 ? toolCalls : null,
    });
    messages.push(message as ChatMessage);

    if (toolCalls.length === 0) {
      const t = message.content?.trim();
      return { reply: t ? sanitizeReply(t) : null, toolsUsed, media: ctx.media };
    }

    let staySilentCalled = false;
    for (const call of toolCalls) {
      if (call.type !== 'function') continue;
      const name = call.function.name;
      toolsUsed.push(name);
      if (name === 'stay_silent') staySilentCalled = true;

      const result = await runTool(toolMap, name, call.function.arguments, ctx);
      const content = JSON.stringify(result);

      await store.appendMessage(conversation.id, { role: 'tool', content, toolCallId: call.id });
      messages.push({ role: 'tool', tool_call_id: call.id, content });
    }

    // Silencio determinístico: stay_silent (ej. mensaje ajeno, soporte
    // técnico, derivar a asesor) siempre corta el turno sin texto, no
    // dejamos esto librado a que el modelo además recuerde no escribir nada.
    // mostrar_seccion (sea "pequenos", "piedra" o "metal") YA NO es
    // silencioso en ningún caso: siempre lleva un mensaje de texto de
    // presentación/cierre.
    if (staySilentCalled) {
      return { reply: null, toolsUsed, media: ctx.media };
    }
  }

  logger.warn({ conversationId: conversation.id, toolsUsed }, 'el agente agotó las iteraciones de herramientas');
  return { reply: null, toolsUsed, media: ctx.media };
}

/**
 * Detección de pedido de información totalmente genérico ("info", "me
 * pasan el catálogo", "qué modelos tienen", etc.), SIN ninguna pista real
 * de tamaño o modelo puntual.
 *
 * A propósito NO es una lista de frases exactas: un mensaje real de cliente
 * casi nunca es la frase pelada ("info"), siempre trae saludo, "porfa",
 * "quisiera", etc. — una lista de frases exactas se queda corta con la
 * variedad real y el pedido termina cayendo al criterio del LLM (que en la
 * práctica alguna vez termina llamando buscar_modelo con un número inventado
 * en vez de mostrar el panorama completo). Por eso se matchea por PALABRA
 * CLAVE: alcanza con que aparezca una palabra de intención de info/catálogo,
 * Y que no haya ningún número ni código de línea en el mensaje (eso sí es
 * una pista puntual, ahí no hay que interceptar — que siga el camino normal
 * con buscar_modelo).
 */
const LINEAS_CONOCIDAS = ['ovniplus', 'ovni', 'microplus', 'micro', 'hhd', 'rcaim', 'piedra', 'metal'];

function mencionaLinea(t: string): boolean {
  return LINEAS_CONOCIDAS.some((l) => new RegExp(`\\b${l}\\b`).test(t));
}

// "grande"/"industrial" hace que corresponda la sección PIEDRA (con texto de
// presentación, no en silencio) — no hay que interceptarlo acá como si fuera
// un pedido de "pequeños".
const PISTA_GRANDE = /\b(grande|grandes|industrial(es)?)\b/;

const SENAL_INFO_GENERICA = /\b(info|informacion|catalogo|modelos?|incubadoras?|maquinas?|productos?)\b/;

function normalizarTexto(t: string): string {
  return t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[¿?¡!.,]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

export function esPedidoGenericoDeInfo(texto: string): boolean {
  const t = normalizarTexto(texto);
  if (/\d/.test(t)) return false;
  if (mencionaLinea(t)) return false;
  if (PISTA_GRANDE.test(t)) return false;
  return SENAL_INFO_GENERICA.test(t);
}

/**
 * Mira el historial guardado y junta las keys que send_product_media ya
 * mandó en esta conversación (no solo en este turno). Así una herramienta
 * puede negarse a reenviar una secuencia larga (ej. metodos_pago) que el
 * cliente ya recibió hace un par de mensajes.
 */
function computeAlreadySent(history: HistoryMessage[]): Set<string> {
  const keys = new Set<string>();
  for (const m of history) {
    if (m.role !== 'assistant' || !m.toolCalls) continue;
    for (const call of m.toolCalls as ToolCall[]) {
      if (call.type !== 'function' || call.function.name !== 'send_product_media') continue;
      try {
        const args = JSON.parse(call.function.arguments) as { product_key?: string };
        if (args.product_key) keys.add(args.product_key);
      } catch {
        // argumentos corruptos/viejos: los ignoramos, no es crítico.
      }
    }
  }
  return keys;
}

function toChat(history: HistoryMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of history) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content ?? '' });
    } else if (m.role === 'assistant') {
      const toolCalls = m.toolCalls as ToolCall[] | null | undefined;
      out.push({
        role: 'assistant',
        content: m.content ?? null,
        ...(toolCalls?.length ? { tool_calls: toolCalls } : {}),
      } as ChatMessage);
    } else if (m.role === 'tool' && m.toolCallId) {
      out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content ?? '' });
    }
  }
  return out;
}

function pruneOrphanToolCalls(messages: ChatMessage[]): ChatMessage[] {
  const out = [...messages];
  while (out.length > 0) {
    const last = out[out.length - 1]!;
    const isAssistantWithTools =
      last.role === 'assistant' && 'tool_calls' in last && Array.isArray(last.tool_calls) && last.tool_calls.length > 0;
    if (!isAssistantWithTools) break;
    out.pop();
  }
  while (out.length > 0 && out[0]!.role === 'tool') out.shift();
  return out;
}

async function runTool(
  toolMap: Map<string, Tool>,
  name: string,
  argsJson: string,
  ctx: ToolContext,
): Promise<unknown> {
  const tool = toolMap.get(name);
  if (!tool) {
    logger.error({ name }, 'el modelo pidió una herramienta que no existe');
    return { error: `La herramienta ${name} no existe.` };
  }

  let args: Record<string, unknown>;
  try {
    args = argsJson ? (JSON.parse(argsJson) as Record<string, unknown>) : {};
  } catch (err) {
    logger.error({ err, name, argsJson }, 'argumentos de herramienta con JSON inválido');
    return { error: 'Los argumentos no son JSON válido. Reintentá con el formato correcto.' };
  }

  try {
    return await tool.run(args, ctx);
  } catch (err) {
    logger.error({ err, name, args }, 'falló la ejecución de una herramienta');
    return { error: 'La herramienta falló. No se lo menciones al usuario; seguí la conversación con naturalidad.' };
  }
}
