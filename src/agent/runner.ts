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
  // pide al modelo que acá llame a mostrar_seccion("pequenos") en silencio,
  // pero en la práctica esa instrucción no siempre se sigue — alguna vez el
  // modelo termina mandando un solo modelo (ej. el más chico) en vez del
  // panorama completo. Para un pedido así de inequívoco no hace falta
  // depender del criterio del modelo: se resuelve acá mismo, siempre igual.
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
    return { reply: null, toolsUsed: ['mostrar_seccion'], media: ctx.media };
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
    let mostrarSeccionPequenos = false;
    let mostrarSeccionNoPequenos = false;
    for (const call of toolCalls) {
      if (call.type !== 'function') continue;
      const name = call.function.name;
      toolsUsed.push(name);
      if (name === 'stay_silent') staySilentCalled = true;
      if (name === 'mostrar_seccion') {
        try {
          const a = JSON.parse(call.function.arguments) as { seccion?: string };
          if (a.seccion === 'pequenos') mostrarSeccionPequenos = true;
          else if (a.seccion) mostrarSeccionNoPequenos = true;
        } catch {
          // argumentos corruptos: no es crítico acá, se maneja en runTool.
        }
      }

      const result = await runTool(toolMap, name, call.function.arguments, ctx);
      const content = JSON.stringify(result);

      await store.appendMessage(conversation.id, { role: 'tool', content, toolCallId: call.id });
      messages.push({ role: 'tool', tool_call_id: call.id, content });
    }

    // Silencio determinístico (regla de negocio, no dejamos esto librado a
    // que el modelo se acuerde de llamar stay_silent todas las veces):
    // - mostrar_seccion con seccion="pequenos" SIEMPRE corta el turno sin
    //   texto, lo haya pedido el cliente vago/chico o de forma genérica.
    // - stay_silent (ej. mensaje ajeno) también corta el turno.
    // - PERO mostrar_seccion con PIEDRA/METAL NUNCA es silencioso (siempre
    //   lleva texto de presentación) — si el modelo llamó a stay_silent de
    //   todas formas (confundiéndolo con el caso "pequeños"), lo ignoramos.
    if ((staySilentCalled || mostrarSeccionPequenos) && !mostrarSeccionNoPequenos) {
      return { reply: null, toolsUsed, media: ctx.media };
    }
  }

  logger.warn({ conversationId: conversation.id, toolsUsed }, 'el agente agotó las iteraciones de herramientas');
  return { reply: null, toolsUsed, media: ctx.media };
}

/**
 * Frases de pedido de información totalmente genérico, SIN ninguna pista de
 * tamaño/número — se comparan ya normalizadas (sin tildes, en minúscula, sin
 * signos de puntuación). A propósito es una lista chica y de match exacto,
 * no un regex amplio: así nunca se come por accidente un mensaje que sí
 * tiene una pista real (ej. "info de la ovni", "precio de la de 12") — esos
 * siguen yendo por el camino normal del modelo.
 */
const FRASES_INFO_GENERICA = new Set([
  'info',
  'informacion',
  'info por favor',
  'info porfa',
  'mas informacion',
  'quiero informacion',
  'quisiera informacion',
  'necesito informacion',
  'me pasas info',
  'me pasas la informacion',
  'me pasa info',
  'me pasa la informacion',
  'catalogo',
  'el catalogo',
  'tienen catalogo',
  'quiero el catalogo',
  'quisiera el catalogo',
  'que modelos tienen',
  'cuales modelos tienen',
  'que tienen disponible',
  'que incubadoras tienen',
  'informacion por favor',
]);

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
  return FRASES_INFO_GENERICA.has(normalizarTexto(texto));
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
