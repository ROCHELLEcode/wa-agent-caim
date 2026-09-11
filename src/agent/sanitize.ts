/**
 * Limpieza mínima de la respuesta antes de enviarla. Algunos modelos "narran"
 * como texto lo que debería ser una tool call, o envuelven todo en un bloque de
 * código. Esto lo desarma de forma conservadora.
 */
export function sanitizeReply(reply: string): string {
  let t = reply.trim();
  // Respuesta que es SOLO un bloque de código: le sacamos los fences.
  const fenced = t.match(/^```(?:json|tool_code|text)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1]) t = fenced[1].trim();
  return t;
}
