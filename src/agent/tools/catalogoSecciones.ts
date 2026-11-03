import type { AgentConfig } from '../../config.js';

/**
 * Clasificación de secciones, compartida entre buscar_modelo y
 * mostrar_seccion para que las dos herramientas estén siempre de acuerdo en
 * qué es "pequeño", "PIEDRA" o "METAL" — si esto se definiera por separado
 * en cada archivo, corrían el riesgo de desincronizarse.
 *
 * Reglas de negocio (pedidas explícitamente): PIEDRA es la sección
 * "grande" por defecto. METAL es una categoría aparte que solo se muestra
 * o se recomienda cuando el cliente la pide puntualmente — nunca se mezcla
 * con las sugerencias de PIEDRA ni aparece en el panorama de "grandes".
 */
export type Seccion = 'pequenos' | 'piedra' | 'metal';

type Modelo = AgentConfig['catalogo'][number];

export function clasificar(modelo: Modelo): Seccion {
  if (modelo.linea.startsWith('PIEDRA')) return 'piedra';
  if (modelo.linea.startsWith('METAL')) return 'metal';
  return 'pequenos';
}
