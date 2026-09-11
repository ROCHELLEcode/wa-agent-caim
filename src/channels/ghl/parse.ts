import type { NormalizedMessage } from '../types.js';

/**
 * Traduce el webhook de GoHighLevel a un mensaje normalizado. Módulo puro
 * (sin env ni red) para testearlo con payloads reales.
 *
 * GHL manda dos formas: la acción "Webhook" de un Workflow (snake_case, texto
 * en `message.body`) y el webhook nativo (camelCase, `body` en la raíz).
 * Toleramos las dos. El workflow no manda messageId → el pipeline sintetiza uno.
 */
export function parseInbound(payload: unknown): NormalizedMessage | null {
  const p = (payload ?? {}) as Record<string, unknown>;
  const contactId = firstString(p.contactId, p.contact_id);
  if (!contactId) return null;

  const messageObj = asObject(p.message);
  const text = firstString(p.body, typeof p.message === 'string' ? p.message : undefined, messageObj?.body);
  if (!text) return null;

  const direction = firstString(p.direction)?.toLowerCase();
  const name =
    firstString(p.full_name) ??
    firstString([p.firstName, p.lastName].filter(Boolean).join(' ')) ??
    firstString([p.first_name, p.last_name].filter(Boolean).join(' '));

  return {
    externalContactId: contactId,
    externalConversationId: firstString(p.conversationId),
    externalMessageId: firstString(p.messageId),
    text,
    phone: firstString(p.phone),
    name,
    email: firstString(p.email),
    // Sin direction asumimos entrante (el trigger "Customer Replied" no lo manda).
    isInbound: direction !== 'outbound',
  };
}

function firstString(...values: unknown[]): string | null {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function asObject(v: unknown): Record<string, unknown> | undefined {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}
