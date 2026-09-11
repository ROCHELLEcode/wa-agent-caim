import type { AgentConfig } from '../config.js';

/**
 * Arma el system prompt del turno: la identidad fija (de agent.yaml) más un
 * bloque dinámico con lo que sabemos del usuario. Acá es donde inyectarías más
 * contexto en runtime (nombre, historial resumido, datos de CRM, etc.).
 */
export interface PromptContext {
  config: AgentConfig;
  contactName: string | null;
}

export function buildSystemPrompt({ config, contactName }: PromptContext): string {
  const whoIsUser = contactName
    ? `El usuario se llama ${contactName}.`
    : 'Todavía no sabés el nombre del usuario; preguntáselo con naturalidad si viene al caso.';

  return `${config.system_prompt.trim()}\n\n${whoIsUser}`;
}
