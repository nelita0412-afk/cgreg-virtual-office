-- CGREG Virtual Office — Ampliación funcional (base maestra, atención prioritaria/abierta,
-- historias clínicas electrónicas, consentimiento informado documentado, Trabajo Social).
-- Migración compatible: no elimina datos. Los registros previos se migran a las nuevas estructuras.

-- ===================== ROLES Y ESPECIALIDADES =====================
alter table core.usuarios drop constraint if exists usuarios_rol_check;
alter table core.usuarios add constraint usuarios_rol_check
  check (rol in ('admin','coordinacion','profesional','territorial','autoridad','auditoria','trabajo_social'));

alter table core.profesionales drop constraint if exists profesionales_especialidad_check;
alter table core.profesionales add constraint profesionales_especialidad_check
  check (especialidad in ('psicologia','telemedicina','psiquiatria','trabajo_social'));

-- ===================== BASE MAESTRA DE SERVIDORES =====================
alter table ops.servidores
  add column unidad text,
  add column estado_servidor text,
  add column contacto_validado boolean,
  add column en_base_maestra boolean not null default false,
  add column en_santa_cruz boolean,
  add column verificacion text not null default 'pendiente_verificacion'
    check (verificacion in ('verificado_maestra','verificado_manual','pendiente_verificacion','no_verificable')),
  add column verificacion_nota text,
  add column origen text not null default 'matriz_valoraciones'
    check (origen in ('matriz_personal','matriz_valoraciones','solicitud_abierta')),
  add column contacto_cifrado text;

-- registros_fuente cubre ahora las dos pestañas autorizadas («Personal» y «Valoraciones»).
alter table ops.registros_fuente
  alter column servidor_id drop not null,
  add column tipo text not null default 'valoracion' check (tipo in ('personal','valoracion')),
  add column codigo_institucional text,
  add column canal_contacto text,
  add column aviso_privacidad boolean;
create index on ops.registros_fuente (codigo_institucional);

alter table ops.sync_ejecuciones
  add column detalle jsonb not null default '{}'::jsonb;

-- ===================== CLASIFICACIÓN DE RIESGO (solo registros profesionales) =====================
create table clinical.clasificaciones_riesgo (
  id                   uuid primary key default gen_random_uuid(),
  servidor_id          uuid not null references ops.servidores(id),
  nivel                text not null check (nivel = 'alto'),
  fuente               text not null check (fuente in ('matriz_valoraciones','registro_profesional')),
  registro_fuente_id   text,               -- ID_Valoracion cuando proviene de la matriz
  valor_origen         text,               -- valor literal registrado en la matriz
  fecha_valoracion     date,
  requiere_seguimiento boolean,
  profesional_id       text references core.profesionales(id), -- profesional que valida (registro en plataforma)
  registrado_por       uuid references core.usuarios(id),
  vigente              boolean not null default true,
  created_at           timestamptz not null default now(),
  retirada_at          timestamptz,
  retirada_por         uuid references core.usuarios(id),
  motivo_retiro        text
);
create unique index clasificacion_fuente_uq on clinical.clasificaciones_riesgo (fuente, registro_fuente_id) where registro_fuente_id is not null;
create index on clinical.clasificaciones_riesgo (servidor_id) where vigente;

-- ===================== ATENCIÓN ABIERTA (solicitud voluntaria) =====================
create sequence ops.solicitud_atencion_seq;
create table ops.solicitudes_atencion (
  id                         uuid primary key default gen_random_uuid(),
  codigo                     text not null unique default ('SA-' || lpad(nextval('ops.solicitud_atencion_seq')::text, 4, '0')),
  canal                      text not null check (canal in ('formulario_publico','registro_interno')),
  servidor_id                uuid references ops.servidores(id),
  servidor_sugerido_id       uuid references ops.servidores(id),
  codigo_declarado           text,
  nombre_declarado           text not null,
  unidad_declarada           text,
  contacto_cifrado           text not null,
  preferencia_servicio       text not null check (preferencia_servicio in ('psicologia','medicina','no_sabe')),
  horario_preferido          text,
  motivo_cifrado             text,
  acepta_aviso_privacidad    boolean not null check (acepta_aviso_privacidad),
  verificacion               text not null check (verificacion in ('verificado_maestra','verificado_manual','pendiente_verificacion','no_verificable')),
  verificacion_nota          text,
  estado                     text not null default 'pendiente_asignacion'
    check (estado in ('pendiente_asignacion','asignada','programada','atendida','cerrada','cancelada')),
  profesional_asignado_id    text references core.profesionales(id),
  atencion_id                uuid references ops.atenciones(id),
  registrada_por             uuid references core.usuarios(id),
  ip_hash                    text,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  cerrada_at                 timestamptz
);
create table ops.solicitud_atencion_historial (
  id              bigserial primary key,
  solicitud_id    uuid not null references ops.solicitudes_atencion(id),
  accion          text not null,
  estado_anterior text,
  estado_nuevo    text,
  nota_operativa  text,
  actor           uuid references core.usuarios(id),
  ts              timestamptz not null default now()
);

-- ===================== DOCUMENTOS CIFRADOS (repositorio privado) =====================
create table clinical.documentos (
  id                uuid primary key default gen_random_uuid(),
  nombre_original   text not null,
  mime              text not null check (mime in ('application/pdf','image/jpeg','image/png')),
  tamano            int not null,
  sha256            text not null,
  contenido_cifrado bytea not null,
  cargado_por       uuid not null references core.usuarios(id),
  created_at        timestamptz not null default now()
);

-- ===================== CONSENTIMIENTO INFORMADO =====================
create table ops.consentimiento_plantillas (
  id                    uuid primary key default gen_random_uuid(),
  servicio              text not null check (servicio in ('psicologia','telemedicina','psiquiatria')),
  version               text not null,
  titulo                text not null,
  secciones             jsonb not null,
  estado                text not null default 'borrador' check (estado in ('borrador','aprobada','retirada')),
  aprobada_por          uuid references core.usuarios(id),
  aprobada_at           timestamptz,
  aprobacion_referencia text,
  creada_por            uuid references core.usuarios(id),
  created_at            timestamptz not null default now(),
  unique (servicio, version)
);

alter table ops.consentimientos
  add column modalidad text not null default 'constancia_profesional'
    check (modalidad in ('electronica','firmada_manual','constancia_profesional')),
  add column servicio text check (servicio in ('psicologia','telemedicina','psiquiatria')),
  add column plantilla_id uuid references ops.consentimiento_plantillas(id),
  add column estado text not null default 'validado'
    check (estado in ('pendiente','cargado','pendiente_validacion','validado','requiere_correccion','revocado','no_otorgado')),
  add column documento_id uuid references clinical.documentos(id),
  add column fecha_recepcion timestamptz,
  add column cargado_por uuid references core.usuarios(id),
  add column validado_por uuid references core.usuarios(id),
  add column validado_at timestamptz,
  add column observaciones text,
  add column revocado_por uuid references core.usuarios(id),
  add column motivo_revocacion text,
  add column evidencia jsonb not null default '{}'::jsonb,
  add column updated_at timestamptz not null default now();

-- Registros previos = constancias profesionales (se conservan tal cual).
update ops.consentimientos set estado = case when revocado_at is not null then 'revocado' when otorgado then 'validado' else 'no_otorgado' end;

create table ops.consentimiento_historial (
  id               bigserial primary key,
  consentimiento_id uuid not null references ops.consentimientos(id),
  accion           text not null,
  estado_anterior  text,
  estado_nuevo     text,
  nota             text,
  documento_id     uuid references clinical.documentos(id),
  actor            uuid references core.usuarios(id),
  ip               text,
  ts               timestamptz not null default now()
);
insert into ops.consentimiento_historial (consentimiento_id, accion, estado_nuevo, nota, actor, ts)
  select id, 'migrado', estado, 'Registro previo a la ampliación (constancia profesional)', registrado_por, fecha from ops.consentimientos;

create table ops.consentimiento_tokens (
  id                uuid primary key default gen_random_uuid(),
  consentimiento_id uuid not null references ops.consentimientos(id),
  token_hash        text not null unique,
  expira_at         timestamptz not null,
  usado_at          timestamptz,
  intentos          int not null default 0,
  created_at        timestamptz not null default now()
);

-- ===================== HISTORIA CLÍNICA ELECTRÓNICA =====================
create sequence clinical.expediente_seq;
create table clinical.expedientes (
  id                         uuid primary key default gen_random_uuid(),
  codigo                     text not null unique default ('HC-' || lpad(nextval('clinical.expediente_seq')::text, 5, '0')),
  servidor_id                uuid not null unique references ops.servidores(id),
  fecha_apertura             timestamptz not null default now(),
  profesional_responsable_id text not null references core.profesionales(id),
  especialidad_apertura      text not null,
  estado                     text not null default 'abierto' check (estado in ('abierto','cerrado')),
  abierto_por                uuid references core.usuarios(id),
  updated_at                 timestamptz not null default now()
);

-- Secciones del expediente, diferenciadas por área y versionadas (cada cambio = nueva versión).
create table clinical.expediente_secciones (
  id                   bigserial primary key,
  expediente_id        uuid not null references clinical.expedientes(id),
  area                 text not null check (area in ('psicologia','medicina','psiquiatria')),
  seccion              text not null check (seccion in ('motivo_consulta','antecedentes','valoracion','evaluacion_clinica','plan_atencion','recomendaciones')),
  version              int not null,
  contenido_cifrado    text not null,
  autor_profesional_id text not null references core.profesionales(id),
  autor_usuario_id     uuid not null references core.usuarios(id),
  motivo_cambio        text,
  created_at           timestamptz not null default now(),
  unique (expediente_id, area, seccion, version)
);

-- Entradas cronológicas: una por atención (o nota previa migrada).
create table clinical.entradas (
  id                   uuid primary key default gen_random_uuid(),
  expediente_id        uuid not null references clinical.expedientes(id),
  atencion_id          uuid unique references ops.atenciones(id),
  area                 text not null check (area in ('psicologia','medicina','psiquiatria')),
  tipo                 text not null default 'consulta' check (tipo in ('consulta','valoracion_psiquiatrica','nota_previa')),
  fecha_hora           timestamptz not null,
  autor_profesional_id text not null references core.profesionales(id),
  confidencialidad     text not null default 'equipo_clinico' check (confidencialidad in ('equipo_clinico','restringida')),
  version_actual       int not null default 1,
  contenido_cifrado    text not null,
  estado               text not null default 'borrador' check (estado in ('borrador','validada')),
  validada_at          timestamptz,
  validada_por         uuid references core.usuarios(id),
  hash_contenido       text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index on clinical.entradas (expediente_id, fecha_hora);

create table clinical.entrada_versiones (
  id                bigserial primary key,
  entrada_id        uuid not null references clinical.entradas(id),
  version           int not null,
  contenido_cifrado text not null,
  autor_usuario_id  uuid references core.usuarios(id),
  created_at        timestamptz not null default now(),
  unique (entrada_id, version)
);

create table clinical.adendas (
  id                   uuid primary key default gen_random_uuid(),
  entrada_id           uuid not null references clinical.entradas(id),
  contenido_cifrado    text not null,
  motivo               text not null,
  autor_profesional_id text not null references core.profesionales(id),
  autor_usuario_id     uuid not null references core.usuarios(id),
  hash_contenido       text not null,
  created_at           timestamptz not null default now()
);

-- Migración de las notas existentes (sin descifrar: se conserva el contenido cifrado tal cual).
insert into clinical.expedientes (servidor_id, profesional_responsable_id, especialidad_apertura, fecha_apertura)
  select distinct on (a.servidor_id) a.servidor_id, n.autor_profesional_id, a.tipo, n.created_at
    from clinical.notas_atencion n join ops.atenciones a on a.id = n.atencion_id
   order by a.servidor_id, n.created_at;
insert into clinical.entradas (expediente_id, atencion_id, area, tipo, fecha_hora, autor_profesional_id, contenido_cifrado, created_at, updated_at)
  select e.id, n.atencion_id,
         case a.tipo when 'telemedicina' then 'medicina' else a.tipo end,
         'consulta', coalesce(a.iniciada_at, a.inicio, n.created_at), n.autor_profesional_id, n.contenido_cifrado, n.created_at, n.updated_at
    from clinical.notas_atencion n join ops.atenciones a on a.id = n.atencion_id join clinical.expedientes e on e.servidor_id = a.servidor_id;
insert into clinical.entrada_versiones (entrada_id, version, contenido_cifrado, created_at)
  select id, 1, contenido_cifrado, created_at from clinical.entradas;
drop table clinical.notas_atencion;
-- Vista de compatibilidad con la estructura anterior (solo lectura).
create view clinical.notas_atencion as
  select atencion_id, autor_profesional_id, contenido_cifrado, created_at, updated_at from clinical.entradas where atencion_id is not null;

alter table ops.atenciones
  add column inicio_urgente boolean not null default false,
  add column justificacion_urgencia_cifrada text;

-- ===================== INTERVENCIÓN SOCIAL (separada de lo clínico) =====================
create schema if not exists social;
create table social.intervenciones (
  id                uuid primary key default gen_random_uuid(),
  servidor_id       uuid not null references ops.servidores(id),
  profesional_id    text not null references core.profesionales(id),
  autor_usuario_id  uuid not null references core.usuarios(id),
  fecha             timestamptz not null,
  tipo              text not null check (tipo in ('valoracion_social','visita','gestion_recursos','articulacion','seguimiento','otra')),
  contenido_cifrado text not null,
  created_at        timestamptz not null default now()
);

-- ===================== INMUTABILIDAD Y TRAZABILIDAD =====================
create or replace function clinical.solo_insercion() returns trigger language plpgsql as $$
begin
  raise exception 'Registro clínico inmutable: % no permitido en %', tg_op, tg_table_name;
end $$;

create trigger versiones_inmutables before update or delete on clinical.entrada_versiones for each row execute function clinical.solo_insercion();
create trigger adendas_inmutables before update or delete on clinical.adendas for each row execute function clinical.solo_insercion();
create trigger secciones_inmutables before update or delete on clinical.expediente_secciones for each row execute function clinical.solo_insercion();
create trigger documentos_inmutables before update or delete on clinical.documentos for each row execute function clinical.solo_insercion();
create trigger expedientes_sin_borrado before delete on clinical.expedientes for each row execute function clinical.solo_insercion();
create trigger entradas_sin_borrado before delete on clinical.entradas for each row execute function clinical.solo_insercion();
create trigger social_inmutable before update or delete on social.intervenciones for each row execute function clinical.solo_insercion();
create trigger clasificacion_sin_borrado before delete on clinical.clasificaciones_riesgo for each row execute function clinical.solo_insercion();
create trigger consent_hist_inmutable before update or delete on ops.consentimiento_historial for each row execute function clinical.solo_insercion();
create trigger consent_sin_borrado before delete on ops.consentimientos for each row execute function clinical.solo_insercion();

-- Una entrada validada no puede modificarse en silencio (solo adendas).
create or replace function clinical.proteger_entrada_validada() returns trigger language plpgsql as $$
begin
  if old.estado = 'validada' then
    if new.estado <> 'validada' or new.contenido_cifrado is distinct from old.contenido_cifrado
       or new.area <> old.area or new.fecha_hora <> old.fecha_hora or new.autor_profesional_id <> old.autor_profesional_id
       or new.confidencialidad <> old.confidencialidad or new.hash_contenido is distinct from old.hash_contenido then
      raise exception 'La entrada validada es inmutable; registre una adenda';
    end if;
  end if;
  return new;
end $$;
create trigger entrada_validada_inmutable before update on clinical.entradas for each row execute function clinical.proteger_entrada_validada();

-- Atenciones cerradas: sin borrado y sin cambios de estado.
create or replace function ops.proteger_atencion_cerrada() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Las atenciones no se eliminan';
  end if;
  if old.estado in ('atendida','no_realizada','reprogramada') and new.estado <> old.estado then
    raise exception 'La atención % está cerrada (%)', old.codigo, old.estado;
  end if;
  return new;
end $$;
create trigger atencion_cerrada before update or delete on ops.atenciones for each row execute function ops.proteger_atencion_cerrada();
