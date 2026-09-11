-- ─────────────────────────────────────────────────────────────
-- Esquema base, genérico: contactos, conversaciones, mensajes.
-- (Tu agente le agrega sus propias tablas de dominio en migraciones nuevas.)
-- ─────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Auditoría cruda de lo que entra por webhook. Sirve para idempotencia (los
-- proveedores reintentan) y para reconstruir qué pasó si algo falla.
CREATE TABLE IF NOT EXISTS webhook_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider      text NOT NULL,
  event_type    text,
  external_id   text,
  payload       jsonb NOT NULL,
  processed_at  timestamptz,
  error         text,
  received_at   timestamptz NOT NULL DEFAULT now()
);

-- Un mismo mensaje reenviado no se procesa dos veces.
CREATE UNIQUE INDEX IF NOT EXISTS webhook_events_provider_external_id_key
  ON webhook_events (provider, external_id)
  WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS webhook_events_received_at_idx
  ON webhook_events (received_at DESC);


CREATE TABLE IF NOT EXISTS contacts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Id del contacto en el sistema externo (número de WhatsApp, id de GHL, etc.)
  external_id  text NOT NULL UNIQUE,
  phone        text,
  name         text,
  email        text,
  -- Espacio libre para lo que traiga el canal (atribución, tags, etc.)
  metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contacts_phone_idx ON contacts (phone);


CREATE TABLE IF NOT EXISTS conversations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id       uuid NOT NULL REFERENCES contacts (id) ON DELETE CASCADE,
  external_id      text UNIQUE,
  -- open | handed_off | closed
  status           text NOT NULL DEFAULT 'open',
  -- Cuando un humano toma la conversación, se apaga el agente.
  agent_enabled    boolean NOT NULL DEFAULT true,
  last_message_at  timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS conversations_contact_id_idx ON conversations (contact_id);
CREATE INDEX IF NOT EXISTS conversations_last_message_at_idx ON conversations (last_message_at DESC);


CREATE TABLE IF NOT EXISTS messages (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id       uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  external_message_id   text,
  -- user | assistant | tool
  role                  text NOT NULL,
  content               text,
  -- Llamadas a herramientas que pidió el modelo (formato OpenAI).
  tool_calls            jsonb,
  -- Id de la llamada que responde este mensaje, cuando role = 'tool'.
  tool_call_id          text,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS messages_external_message_id_key
  ON messages (external_message_id)
  WHERE external_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS messages_conversation_created_idx
  ON messages (conversation_id, created_at);


-- updated_at automático.
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS contacts_touch_updated_at ON contacts;
CREATE TRIGGER contacts_touch_updated_at
  BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS conversations_touch_updated_at ON conversations;
CREATE TRIGGER conversations_touch_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
