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

/**
 * Nombre del modelo en el orden que pidió el negocio: SIEMPRE la cantidad
 * seguida de "huevos", y recién después el código del modelo si tiene uno
 * (ej. "12 huevos HHD", "26 huevos OVNI", "128 huevos PIEDRA") — nunca el
 * código pegado al número antes de "huevos" (mal: "12 HHD huevos"), porque
 * confunde al cliente sobre qué número es la cantidad de huevos.
 *
 * `linea` ya trae la cantidad mezclada con el código en formatos distintos
 * ("12 HHD", pero "PIEDRA 128"), así que se la sacamos y reconstruimos el
 * texto siempre igual, en vez de usar `linea` tal cual.
 */
export function nombreModelo(modelo: Modelo): string {
  const linea = modelo.linea.trim();

  // Línea sin código extra, es solo el número (a veces con cero a la
  // izquierda, ej. "06" para 6 huevos): no hay nada que reordenar.
  if (/^0*\d+$/.test(linea) && Number(linea) === modelo.capacidad) {
    return `${modelo.capacidad} huevos`;
  }

  const num = String(modelo.capacidad);
  let codigo = linea;
  if (codigo.startsWith(`${num} `)) {
    codigo = codigo.slice(num.length);
  } else if (codigo.endsWith(` ${num}`)) {
    codigo = codigo.slice(0, codigo.length - num.length);
  }
  codigo = codigo.trim();

  return codigo ? `${modelo.capacidad} huevos ${codigo}` : `${modelo.capacidad} huevos`;
}
