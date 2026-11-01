import type { Tool } from '../index.js';

/**
 * Corta la conversación y la deriva a una persona: pausa al agente para ESTE
 * contacto (mismo mecanismo que el comando manual /nn de la coexistencia
 * de WhatsApp). El bot no vuelve a responder en esta conversación hasta que
 * alguien del equipo escriba /ss desde la app.
 *
 * Pensada para negocios con muchos clientes existentes que a diario piden
 * soporte, repuestos o ayuda con máquinas ya compradas: el bot solo vende,
 * todo lo demás lo deriva de una.
 */
export const derivarAAsesor: Tool = {
  definition: {
    type: 'function',
    function: {
      name: 'derivar_a_asesor',
      description:
        'Usala cuando el cliente pide soporte técnico, ayuda para usar una máquina que ya tiene, repuestos, accesorios sueltos, o cualquier cosa que NO sea comprar una incubadora nueva. Después de llamarla, mandá un único mensaje corto avisando que en breve lo atenderá un asesor, y no respondas nada más en esta conversación.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  async run(_args, ctx) {
    await ctx.store.setAgentEnabled(ctx.conversationId, false);
    return { ok: true };
  },
};
