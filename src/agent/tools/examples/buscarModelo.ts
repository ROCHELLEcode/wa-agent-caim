import { loadConfig } from '../../../config.js';
import { positiveNumber, text } from '../../args.js';
import type { Tool } from '../index.js';
import { nombreModelo } from '../catalogoSecciones.js';

/**
 * Busca el/los modelo(s) que corresponden EXACTAMENTE a lo que pidió el
 * cliente (capacidad y/o línea), calculado en código sobre `catalogo`
 * (config/agent.yaml) — no por búsqueda de texto, así el precio que da el
 * bot es siempre exacto. Regla de negocio (pedida explícitamente): esta
 * herramienta NUNCA sugiere modelos de otras capacidades o líneas que el
 * cliente no pidió — "opciones" es siempre la respuesta completa, nunca una
 * sola "adivinada" con alternativas "cercanas" agregadas de más:
 *
 * - Pidió una capacidad que existe exacta (con o sin línea): "opciones" trae
 *   SOLO el/los modelo(s) de esa capacidad exacta (puede ser más de uno si
 *   no se dio línea y hay varios modelos a esa misma capacidad, ej. "24" y
 *   "24 MICROPLUS").
 * - Pidió una línea sin capacidad puntual (ej. "quiero una MICROPLUS"):
 *   "opciones" trae TODAS las variantes de esa línea.
 * - Pidió una línea con una capacidad que esa línea NO tiene (ej. "MICROPLUS
 *   de 30 huevos"): "opciones" trae TODAS las variantes de esa línea, para
 *   que el cliente elija cuál quiere en realidad (en vez de adivinar una).
 * - Pidió solo una capacidad que no existe en ningún lado (sin línea): trae
 *   la o las opciones más cercanas disponibles (puede haber empate).
 *
 * TAMBIÉN manda de una las fotos/videos de cada modelo en "opciones" (igual
 * que send_product_media) — así no depende de que el modelo haga una
 * segunda llamada aparte, que en la práctica a veces se "olvidaba" de hacer
 * y el cliente se quedaba sin fotos.
 */
/** Compara por palabra exacta, no por substring: "OVNI" no debe matchear
 * "OVNIPLUS" (son líneas distintas), algo que `linea.includes(codigo)` sí
 * confundía. */
function matchesCodigo(linea: string, codigo: string): boolean {
  return linea.toUpperCase().split(/\s+/).includes(codigo);
}

/**
 * El cliente dice "micro" (forma corta/coloquial), no "MICROPLUS" — y no
 * podemos confiar en que la IA siempre normalice bien la palabra exacta del
 * catálogo antes de llamar a la herramienta. Para no depender de eso, acá
 * se resuelve en código: si el código que llega no matchea ningún modelo
 * tal cual, se prueba por un alias conocido antes de rendirse.
 */
const ALIAS_CODIGO: Record<string, string> = {
  MICRO: 'MICROPLUS',
};

function normalizarCodigo(codigo: string): string {
  return ALIAS_CODIGO[codigo] ?? codigo;
}

export const buscarModelo: Tool = {
  definition: {
    type: 'function',
    function: {
      name: 'buscar_modelo',
      description:
        'Busca el/los modelo(s) que corresponden EXACTAMENTE a lo que pidió el cliente (capacidad y/o línea) Y les manda sus fotos/videos — no hace falta llamar a send_product_media aparte, esta herramienta ya lo hace. Usala SIEMPRE que necesites dar un precio, o responder si un modelo es FULL AUTOMÁTICA o no (el campo "fullAutomatica" que devuelve es el dato exacto, no lo busques en otro lado). Te devuelve "opciones": SOLO los modelos que corresponden a lo pedido, nunca modelos de otra capacidad o línea de más — si hay más de uno (ej. pedís "24 huevos" sin línea y existen "24" normal y "24 MICROPLUS"), mencionalos todos y nada más; si hay uno solo, es el único que mencionás. Podés llamarla solo con codigo_modelo (sin capacidad_huevos) cuando el cliente nombra una línea sin dar capacidad — ahí te da todas las variantes de esa línea para que elija.',
      parameters: {
        type: 'object',
        properties: {
          capacidad_huevos: {
            type: 'number',
            description:
              'Cantidad de huevos que busca el cliente (aproximada si no fue exacta). Si el cliente no dio ningún número — solo nombró una línea/modelo, ej. "quiero una MICROPLUS" — no pases este campo, mandá solo codigo_modelo.',
          },
          codigo_modelo: {
            type: 'string',
            description:
              'Pasalo SIEMPRE que el cliente haya mencionado, en cualquier mensaje de la conversación (incluido el texto/caption de una foto reenviada), una línea específica — tiene PRIORIDAD sobre capacidad_huevos. Códigos válidos: "HHD", "OVNI", "OVNIPLUS", "MICROPLUS", "RCAIM", "PIEDRA", "METAL". El cliente puede decir la forma corta/coloquial (ej. "micro" en vez de "MICROPLUS") — pasala igual, no hace falta que sea el nombre exacto del catálogo.',
          },
        },
        anyOf: [{ required: ['capacidad_huevos'] }, { required: ['codigo_modelo'] }],
        additionalProperties: false,
      },
    },
  },
  async run(args, ctx) {
    const capacidad = positiveNumber(args.capacidad_huevos);
    const codigoModeloCrudo = text(args.codigo_modelo)?.toUpperCase();
    const codigoModelo = codigoModeloCrudo ? normalizarCodigo(codigoModeloCrudo) : undefined;

    if (!capacidad && !codigoModelo) {
      return { error: 'Falta capacidad_huevos y/o codigo_modelo — necesito al menos uno de los dos.' };
    }

    const { catalogo, products } = loadConfig();
    if (catalogo.length === 0) return { error: 'No hay catálogo cargado.' };

    // Si el cliente nombró una línea (ej. MICROPLUS), esa línea tiene
    // PRIORIDAD ABSOLUTA sobre la capacidad: se filtra el catálogo a esa
    // línea ANTES de buscar la capacidad exacta, no solo para desempatar.
    // El match es por TOKEN exacto (no substring): "OVNI" no debe matchear
    // "OVNIPLUS" (son líneas distintas), por eso partimos `linea` en
    // palabras en vez de usar `.includes()`.
    let base = catalogo;
    let lineaFiltrada = false;
    if (codigoModelo) {
      const filtrado = catalogo.filter((m) => matchesCodigo(m.linea, codigoModelo));
      if (filtrado.length > 0) {
        base = filtrado;
        lineaFiltrada = true;
      }
    }

    let opciones: typeof catalogo;
    let capacidadExacta: boolean;

    if (!capacidad) {
      // Solo línea, sin capacidad puntual: todas las variantes de esa línea.
      opciones = base;
      capacidadExacta = true;
    } else {
      const exactos = base.filter((m) => m.capacidad === capacidad);
      if (exactos.length > 0) {
        // Esa capacidad existe tal cual (dentro de la línea, si se dio una) —
        // esto es TODA la respuesta, nunca agregamos nada de otra capacidad.
        opciones = exactos;
        capacidadExacta = true;
      } else if (lineaFiltrada) {
        // La línea pedida no tiene exactamente esa capacidad: en vez de
        // adivinar una sola (bug reportado antes), mandamos TODAS las
        // variantes de esa línea para que el cliente elija cuál quiere.
        opciones = base;
        capacidadExacta = false;
      } else {
        // Ni línea ni capacidad exacta: la(s) opción(es) más cercana(s)
        // disponibles (puede haber empate), sin mezclar secciones de más.
        const ordenado = [...base].sort(
          (a, b) => Math.abs(a.capacidad - capacidad) - Math.abs(b.capacidad - capacidad),
        );
        const distanciaMinima = Math.abs(ordenado[0]!.capacidad - capacidad);
        opciones = ordenado.filter((m) => Math.abs(m.capacidad - capacidad) === distanciaMinima);
        capacidadExacta = false;
      }
    }

    opciones = [...opciones].sort((a, b) => a.capacidad - b.capacidad);

    const yaEnColados = new Set(ctx.media.map((m) => m.url));
    let fotosEnviadas = 0;
    for (const modelo of opciones) {
      const product = products.find((p) => p.key === modelo.key);
      const nuevos = (product?.media ?? []).filter((m) => !yaEnColados.has(m.url));
      for (const n of nuevos) yaEnColados.add(n.url);
      ctx.media.push(...nuevos);
      fotosEnviadas += nuevos.length;
    }

    return {
      opciones: opciones.map((m) => ({ ...m, nombre: nombreModelo(m) })),
      // false cuando se pidió una línea y esa línea NO tiene exactamente esa
      // capacidad (acá "opciones" trae TODAS sus variantes para elegir, no
      // la exacta que pidieron) — en el resto de los casos siempre es true.
      capacidad_exacta: capacidadExacta,
      fotos_videos_enviados: fotosEnviadas,
    };
  },
};
