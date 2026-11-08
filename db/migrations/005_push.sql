-- Suscripciones a notificaciones push (Web Push) de la app instalable.
-- Solo se guarda el destino técnico que entrega el navegador; ningún dato clínico.
create table if not exists ops.push_suscripciones (
  id bigserial primary key,
  usuario_id uuid not null references core.usuarios(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  agente text,
  created_at timestamptz not null default now(),
  ultimo_envio_at timestamptz
);
create index if not exists push_suscripciones_usuario_idx on ops.push_suscripciones (usuario_id);
