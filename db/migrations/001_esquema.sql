-- CGREG Virtual Office — esquema base
-- Esquemas separados: core (identidad y profesionales), ops (operación),
-- clinical (información clínica cifrada a nivel de aplicación) y audit (trazabilidad inmutable).

create extension if not exists btree_gist;

create schema if not exists core;
create schema if not exists ops;
create schema if not exists clinical;
create schema if not exists audit;

-- ===================== CORE =====================
create table core.profesionales (
  id              text primary key,
  nombre          text not null,
  nombre_corto    text not null,
  titulo          text not null,
  especialidad    text not null check (especialidad in ('psicologia','telemedicina','psiquiatria')),
  perfil          text not null,
  experiencia     text[] not null default '{}',
  modalidad       text not null,
  tz              text not null default 'America/Guayaquil',
  estacion        text not null unique,
  color           text not null,
  cabello         text not null default '#2b1d14',
  es_teleatencion boolean not null default true,
  notas_agenda    text,
  orden           int not null default 0,
  activo          boolean not null default true
);

create table core.disponibilidad (
  id            serial primary key,
  profesional_id text not null references core.profesionales(id),
  dia_semana    int not null check (dia_semana between 1 and 7),
  hora_inicio   time not null,
  hora_fin      time not null,
  tz            text not null,
  vigente       boolean not null default true,
  creado_por    uuid,
  created_at    timestamptz not null default now(),
  check (hora_fin > hora_inicio)
);

-- Franjas puntuales confirmadas (Psiquiatría u horarios extraordinarios confirmados).
create table core.franjas_confirmadas (
  id             uuid primary key default gen_random_uuid(),
  profesional_id text not null references core.profesionales(id),
  inicio         timestamptz not null,
  fin            timestamptz not null,
  confirmado_por uuid not null,
  nota           text,
  activa         boolean not null default true,
  created_at     timestamptz not null default now(),
  check (fin > inicio)
);

create table core.usuarios (
  id                    uuid primary key default gen_random_uuid(),
  email                 text not null,
  nombre                text not null,
  rol                   text not null check (rol in ('admin','coordinacion','profesional','territorial','autoridad','auditoria')),
  profesional_id        text unique references core.profesionales(id),
  password_hash         text not null,
  activo                boolean not null default true,
  debe_cambiar_password boolean not null default true,
  intentos_fallidos     int not null default 0,
  bloqueado_hasta       timestamptz,
  ultimo_acceso         timestamptz,
  created_at            timestamptz not null default now()
);
create unique index usuarios_email_uq on core.usuarios (lower(email));

create table core.sesiones (
  id                 text primary key, -- SHA-256 del token; el token en claro solo vive en la cookie
  usuario_id         uuid not null references core.usuarios(id) on delete cascade,
  creada_at          timestamptz not null default now(),
  expira_absoluta    timestamptz not null,
  ultima_actividad   timestamptz not null default now(),
  ip                 text,
  user_agent         text,
  revocada_at        timestamptz
);
create index on core.sesiones (usuario_id);

-- ===================== OPS: servidores =====================
create table ops.servidores (
  id                        uuid primary key default gen_random_uuid(),
  clave_fuente              text not null unique, -- ID_Distributivo (o ID_Valoracion si no existe)
  codigo_institucional      text,
  nombre                    text not null,
  canal_contacto            text,
  aviso_privacidad_aceptado boolean,
  activo_en_fuente          boolean not null default true,
  primera_sincronizacion    timestamptz not null default now(),
  ultima_sincronizacion     timestamptz not null default now()
);

-- Relación estable con el registro de origen en la matriz (pestaña autorizada).
create table ops.registros_fuente (
  registro_id    text primary key, -- ID_Valoracion
  servidor_id    uuid not null references ops.servidores(id),
  hoja           text not null,
  fecha_registro text,
  activo         boolean not null default true,
  ultima_vista   timestamptz not null default now()
);

create table ops.asignaciones (
  id             uuid primary key default gen_random_uuid(),
  servidor_id    uuid not null references ops.servidores(id),
  profesional_id text not null references core.profesionales(id),
  activa         boolean not null default true,
  asignada_por   uuid not null references core.usuarios(id),
  created_at     timestamptz not null default now(),
  finalizada_at  timestamptz
);
create unique index asignacion_activa_uq on ops.asignaciones (servidor_id, profesional_id) where activa;

create table ops.consentimientos (
  id                uuid primary key default gen_random_uuid(),
  servidor_id       uuid not null references ops.servidores(id),
  tipo              text not null check (tipo in ('teleatencion','tratamiento_datos')),
  base_legitimacion text not null check (base_legitimacion in ('consentimiento','interes_vital','funcion_publica')),
  otorgado          boolean not null,
  canal             text,
  profesional_id    text references core.profesionales(id),
  registrado_por    uuid not null references core.usuarios(id),
  fecha             timestamptz not null default now(),
  revocado_at       timestamptz
);

create table ops.contactos (
  id             uuid primary key default gen_random_uuid(),
  servidor_id    uuid not null references ops.servidores(id),
  profesional_id text references core.profesionales(id),
  resultado      text not null check (resultado in ('contactado','no_responde','dato_erroneo','rechaza_atencion')),
  canal          text,
  registrado_por uuid not null references core.usuarios(id),
  fecha          timestamptz not null default now()
);

-- ===================== OPS: atenciones y agenda =====================
create sequence ops.atencion_seq;
create table ops.atenciones (
  id                  uuid primary key default gen_random_uuid(),
  codigo              text not null unique default ('AT-' || lpad(nextval('ops.atencion_seq')::text, 5, '0')),
  servidor_id         uuid not null references ops.servidores(id),
  profesional_id      text not null references core.profesionales(id),
  tipo                text not null check (tipo in ('psicologia','telemedicina','psiquiatria')),
  modalidad           text not null default 'virtual',
  inicio              timestamptz,
  fin                 timestamptz,
  duracion_min        int,
  estado              text not null check (estado in ('pendiente','programada','confirmada','en_atencion','atendida','reprogramada','no_realizada')),
  derivacion_id       uuid,
  reprogramada_desde  uuid references ops.atenciones(id),
  iniciada_at         timestamptz,
  finalizada_at       timestamptz,
  documentada_at      timestamptz,
  motivo_no_realizada text,
  creado_por          uuid not null references core.usuarios(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint atencion_horario check (estado = 'pendiente' or (inicio is not null and fin is not null and fin > inicio)),
  constraint atencion_sin_choque_profesional exclude using gist
    (profesional_id with =, tstzrange(inicio, fin) with &&) where (estado in ('programada','confirmada','en_atencion')),
  constraint atencion_sin_choque_servidor exclude using gist
    (servidor_id with =, tstzrange(inicio, fin) with &&) where (estado in ('programada','confirmada','en_atencion'))
);
create index on ops.atenciones (profesional_id, inicio);
create index on ops.atenciones (servidor_id);

create table ops.atencion_historial (
  id              bigserial primary key,
  atencion_id     uuid not null references ops.atenciones(id),
  estado_anterior text,
  estado_nuevo    text not null,
  actor           uuid not null references core.usuarios(id),
  nota_operativa  text,
  ts              timestamptz not null default now()
);

-- ===================== CLINICAL (contenido cifrado AES-256-GCM) =====================
create table clinical.notas_atencion (
  atencion_id          uuid primary key references ops.atenciones(id),
  autor_profesional_id text not null references core.profesionales(id),
  contenido_cifrado    text not null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- ===================== DERIVACIONES =====================
create sequence ops.derivacion_seq;
create table ops.derivaciones (
  id                       uuid primary key default gen_random_uuid(),
  codigo                   text not null unique default ('DPQ-' || lpad(nextval('ops.derivacion_seq')::text, 4, '0')),
  servidor_id              uuid not null references ops.servidores(id),
  profesional_derivante_id text not null references core.profesionales(id),
  especialista_id          text not null references core.profesionales(id),
  prioridad                text not null check (prioridad in ('baja','media','alta','urgente')),
  estado                   text not null check (estado in ('solicitada','en_revision','pendiente_coordinacion','aceptada','programada','valorada','en_seguimiento','cerrada')),
  fecha_solicitud          timestamptz not null default now(),
  atencion_id              uuid references ops.atenciones(id),
  creado_por               uuid not null references core.usuarios(id),
  updated_at               timestamptz not null default now(),
  cerrada_at               timestamptz
);
alter table ops.atenciones add constraint atencion_derivacion_fk foreign key (derivacion_id) references ops.derivaciones(id);

create table clinical.derivacion_detalle (
  derivacion_id             uuid primary key references ops.derivaciones(id),
  motivo_cifrado            text not null,
  valoracion_cifrada        text,
  recomendaciones_cifradas  text,
  seguimiento_cifrado       text,
  updated_at                timestamptz not null default now()
);

create table ops.derivacion_historial (
  id              bigserial primary key,
  derivacion_id   uuid not null references ops.derivaciones(id),
  estado_anterior text,
  estado_nuevo    text not null,
  actor           uuid not null references core.usuarios(id),
  nota_operativa  text,
  ts              timestamptz not null default now()
);

-- ===================== SEGUIMIENTOS Y NECESIDADES =====================
create table ops.seguimientos (
  id                 uuid primary key default gen_random_uuid(),
  servidor_id        uuid not null references ops.servidores(id),
  profesional_id     text not null references core.profesionales(id),
  fecha_programada   timestamptz not null,
  estado             text not null default 'pendiente' check (estado in ('pendiente','realizado','cancelado')),
  nota_operativa     text,
  atencion_origen_id uuid references ops.atenciones(id),
  creado_por         uuid not null references core.usuarios(id),
  created_at         timestamptz not null default now(),
  realizado_at       timestamptz
);

create table ops.necesidades (
  id             uuid primary key default gen_random_uuid(),
  servidor_id    uuid not null references ops.servidores(id),
  categoria      text not null check (categoria in ('vivienda','alimentacion','salud','psicosocial','economica','laboral','educativa','documentacion','otra')),
  descripcion    text not null,
  estado         text not null default 'pendiente' check (estado in ('pendiente','parcial','resuelta')),
  registrada_por uuid not null references core.usuarios(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  resuelta_at    timestamptz
);

-- ===================== SOLICITUDES A COORDINACIÓN =====================
create sequence ops.solicitud_seq;
create table ops.solicitudes (
  id                         uuid primary key default gen_random_uuid(),
  codigo                     text not null unique default ('SOL-' || lpad(nextval('ops.solicitud_seq')::text, 4, '0')),
  solicitante_id             uuid not null references core.usuarios(id),
  tipo                       text not null,
  descripcion                text not null,
  accion_requerida           text not null,
  prioridad                  text not null check (prioridad in ('baja','media','alta','urgente')),
  fecha_respuesta_requerida  date,
  observaciones              text,
  servidor_id                uuid references ops.servidores(id),
  estado                     text not null default 'nueva' check (estado in ('nueva','recibida','en_gestion','pendiente_respuesta_externa','requiere_informacion','resuelta','cerrada')),
  fecha_seguimiento          date,
  institucion_contactada     text,
  respuesta                  text,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  cerrada_at                 timestamptz
);

create table ops.solicitud_acciones (
  id                bigserial primary key,
  solicitud_id      uuid not null references ops.solicitudes(id),
  accion            text not null,
  comentario        text,
  institucion       text,
  fecha_seguimiento date,
  estado_anterior   text,
  estado_nuevo      text,
  actor_id          uuid not null references core.usuarios(id),
  ts                timestamptz not null default now()
);

-- ===================== DEBRIEFING, CAPACITACIÓN, TERRITORIO =====================
create table ops.debriefings (
  id                       uuid primary key default gen_random_uuid(),
  titulo                   text not null,
  facilitador_id           text not null references core.profesionales(id),
  grupo_destinatario       text not null,
  inicio                   timestamptz not null,
  fin                      timestamptz not null,
  participantes_previstos  int not null default 0 check (participantes_previstos >= 0),
  participantes_asistentes int check (participantes_asistentes >= 0),
  estado                   text not null default 'programada' check (estado in ('programada','en_curso','realizada','cancelada')),
  seguimiento              text,
  creado_por               uuid not null references core.usuarios(id),
  created_at               timestamptz not null default now(),
  iniciado_at              timestamptz,
  finalizado_at            timestamptz,
  check (fin > inicio)
);

create table ops.capacitaciones (
  id                       uuid primary key default gen_random_uuid(),
  tema                     text not null,
  titulo                   text not null,
  facilitador_id           text not null references core.profesionales(id),
  publico_objetivo         text not null,
  institucion              text,
  inicio                   timestamptz not null,
  duracion_min             int not null check (duracion_min > 0),
  participantes_previstos  int not null default 0,
  participantes_asistentes int,
  estado                   text not null default 'programada' check (estado in ('programada','en_curso','realizada','cancelada')),
  observaciones            text,
  creado_por               uuid not null references core.usuarios(id),
  created_at               timestamptz not null default now(),
  iniciado_at              timestamptz,
  finalizado_at            timestamptz
);

create table ops.articulaciones (
  id             uuid primary key default gen_random_uuid(),
  usuario_id     uuid not null references core.usuarios(id),
  fecha          timestamptz not null,
  lugar          text not null,
  tipo           text not null check (tipo in ('acompanamiento','contencion_grupal','coordinacion_educativa','reunion_equipo','otra')),
  descripcion    text not null,
  participantes  int,
  requiere_apoyo boolean not null default false,
  created_at     timestamptz not null default now()
);

-- ===================== PRESENCIA, EVENTOS, NOTIFICACIONES =====================
create table ops.presencia (
  usuario_id       uuid primary key references core.usuarios(id),
  conectado        boolean not null default false,
  estado           text not null default 'desconectado',
  zona             text not null default 'fuera',
  ref_tipo         text,
  ref_id           uuid,
  desde            timestamptz not null default now(),
  ultimo_heartbeat timestamptz
);

create table ops.presencia_historial (
  id         bigserial primary key,
  usuario_id uuid not null references core.usuarios(id),
  conectado  boolean not null,
  estado     text not null,
  zona       text not null,
  ts         timestamptz not null default now()
);

create table ops.eventos (
  id               bigserial primary key,
  ts               timestamptz not null default now(),
  tipo             text not null,
  topic            text not null,
  actor_usuario_id uuid references core.usuarios(id),
  texto_publico    text,           -- apto para el feed general: nunca nombres de servidores ni motivos clínicos
  destinatarios    uuid[],         -- null = difusión general
  payload          jsonb not null default '{}'::jsonb
);
create index on ops.eventos (ts desc);

create table ops.notificaciones (
  id         uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references core.usuarios(id),
  tipo       text not null,
  titulo     text not null,
  cuerpo     text,
  enlace     text,
  created_at timestamptz not null default now(),
  leida_at   timestamptz
);
create index on ops.notificaciones (usuario_id, created_at desc);

create table ops.sync_ejecuciones (
  id                   bigserial primary key,
  inicio               timestamptz not null default now(),
  fin                  timestamptz,
  estado               text not null check (estado in ('en_curso','ok','error','no_configurado')),
  hoja                 text,
  registros_procesados int not null default 0,
  creados              int not null default 0,
  actualizados         int not null default 0,
  errores              jsonb not null default '[]'::jsonb,
  mensaje              text
);

-- ===================== AUDITORÍA (solo inserción) =====================
create table audit.registro (
  id         bigserial primary key,
  ts         timestamptz not null default now(),
  usuario_id uuid,
  rol        text,
  accion     text not null,
  entidad    text,
  entidad_id text,
  detalle    jsonb not null default '{}'::jsonb,
  ip         text
);
create index on audit.registro (ts desc);

create or replace function audit.bloquear_modificacion() returns trigger language plpgsql as $$
begin
  raise exception 'El registro de auditoría es inmutable';
end $$;
create trigger audit_inmutable before update or delete on audit.registro
  for each row execute function audit.bloquear_modificacion();
create trigger audit_no_truncate before truncate on audit.registro
  for each statement execute function audit.bloquear_modificacion();
