import type { Tool } from '../index.js';

/**
 * Herramienta de "no responder". Existe porque pedirle al modelo por prompt
 * que "deje el texto vacío" no es confiable: en la práctica termina
 * escribiendo su razonamiento en el mensaje ("no debo responder porque...").
 * Al convertir el silencio en una llamada a herramienta, el runner puede
 * cortar el turno ahí mismo y garantizar que no sale texto, pase lo que pase.
 */
export const staySilent: Tool = {
  definition: {
    type: 'function',
    function: {
      name: 'stay_silent',
      description:
        'Llamala en vez de escribir texto cuando el mensaje NO tiene nada que ver con incubadoras de huevos ni con CAIM (por ejemplo: spam, saludos genéricos de otro contexto, temas totalmente ajenos, u otro negocio). No llames ninguna otra herramienta ni escribas texto en el mismo turno: esta herramienta corta el turno y no se envía nada al cliente.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  async run() {
    return { ok: true };
  },
};
