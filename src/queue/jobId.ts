/**
 * Vive en su propio módulo sin importar nada: queues.ts abre conexiones a Redis
 * al importarse, y un test de esto no debería levantar Redis.
 *
 * El separador NO puede ser ':' — BullMQ lo rechaza ("Custom Id cannot contain
 * :") porque usa ese carácter para namespaciar sus claves en Redis.
 */
export function buildJobId(conversationId: string, sequence: number): string {
  return `${conversationId}__${sequence}`;
}
