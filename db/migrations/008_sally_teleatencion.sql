-- 1. Consolidación de identidad: Sally Tinizaray Soriano y «Zally Pamela» son la MISMA persona.
--    «zally-pamela» es el identificador canónico: conserva su trayectoria (horario, citas, casos, actividades).
--    El registro «sally-tinizaray» (creado por la migración 007) se retira sin borrarse y queda como alias.
--    Todo lo que pueda moverse se mueve al registro canónico. Los registros firmados o de solo inserción
--    (adendas, secciones, intervenciones sociales, entradas validadas) NO se reescriben: conservan su autor
--    original y el alias los vincula a la misma persona (core.profesional_canonico).
-- 2. Teleatención: estado «Contacto iniciado», modalidad de la atención y número de WhatsApp autorizado (cifrado).
-- Migración aditiva. Nada se borra; cada paso deja constancia en audit.registro.

-- ===================== 1. Consolidación Sally / Zally =====================
alter table core.profesionales add column if not exists consolidado_en text references core.profesionales(id);

create or replace function core.profesional_canonico(p text) returns text language sql stable as
$$ select coalesce((select consolidado_en from core.profesionales where id = p), p) $$;

-- Nombre y perfil oficiales en el registro canónico (conserva id, horario, puesto y color).
update core.profesionales set
  nombre = 'Sally Tinizaray Soriano', nombre_corto = 'Sally', titulo = 'Psicóloga Clínica', especialidad = 'psicologia',
  perfil = 'Psicóloga clínica, magíster en Intervención Familiar y del Adolescente. Experiencia en Educación Especial y Trastornos del Neurodesarrollo.',
  experiencia = array['Intervención familiar y del adolescente','Educación Especial','Trastornos del Neurodesarrollo','Dificultades del aprendizaje','DECE y coordinación DECE'],
  funcion_brigada = 'Profesional de Salud Mental', en_directorio = true, activo = true,
  nota_directorio = 'Nombre corregido (antes «Zally Pamela»): misma persona. Identificador histórico conservado.'
where id = 'zally-pamela';

do $$
declare
  ref record;
  n int;
  movidos jsonb := '{}'::jsonb;
  existe_dup boolean;
  cuenta_dup uuid;
  cuenta_can uuid;
begin
  select exists(select 1 from core.profesionales where id = 'sally-tinizaray') into existe_dup;
  if not existe_dup then
    return;
  end if;

  -- Asignaciones activas duplicadas: si ambos registros tenían la misma persona asignada, se cierra la del duplicado.
  update ops.asignaciones d set activa = false
   where d.profesional_id = 'sally-tinizaray' and d.activa
     and exists (select 1 from ops.asignaciones c where c.servidor_id = d.servidor_id and c.profesional_id = 'zally-pamela' and c.activa);

  -- Referencias que pueden moverse (tablas sin protección de solo inserción).
  for ref in
    select * from (values
      ('core.disponibilidad', 'profesional_id', ''),
      ('core.franjas_confirmadas', 'profesional_id', ''),
      ('ops.asignaciones', 'profesional_id', ''),
      ('ops.atenciones', 'profesional_id', ''),
      ('ops.capacitaciones', 'facilitador_id', ''),
      ('ops.debriefings', 'facilitador_id', ''),
      ('ops.consentimientos', 'profesional_id', ''),
      ('ops.contactos', 'profesional_id', ''),
      ('ops.derivaciones', 'especialista_id', ''),
      ('ops.derivaciones', 'profesional_derivante_id', ''),
      ('ops.seguimientos', 'profesional_id', ''),
      ('ops.solicitudes_atencion', 'profesional_asignado_id', ''),
      ('clinical.expedientes', 'profesional_responsable_id', ''),
      ('clinical.clasificaciones_riesgo', 'profesional_id', ''),
      ('clinical.entradas', 'autor_profesional_id', ' and estado <> ''validada''')
    ) as t(tabla, columna, condicion)
  loop
    execute format('update %s set %I = ''zally-pamela'' where %I = ''sally-tinizaray''%s', ref.tabla, ref.columna, ref.columna, ref.condicion);
    get diagnostics n = row_count;
    if n > 0 then movidos := movidos || jsonb_build_object(ref.tabla || '.' || ref.columna, n); end if;
  end loop;

  -- Registros firmados o de solo inserción: se conservan intactos y se vinculan por el alias.
  update core.profesionales set activo = false, en_directorio = false, consolidado_en = 'zally-pamela',
         estacion = 'retirado-sally-tinizaray',
         nota_directorio = 'Registro duplicado consolidado en «zally-pamela» (misma persona). Conservado como alias de registros firmados.'
   where id = 'sally-tinizaray';

  -- Cuentas: una sola cuenta activa, vinculada al registro canónico.
  select id into cuenta_dup from core.usuarios where profesional_id = 'sally-tinizaray';
  select id into cuenta_can from core.usuarios where profesional_id = 'zally-pamela';
  if cuenta_dup is not null and cuenta_can is not null then
    -- La cuenta con el nombre oficial queda activa; la cuenta con el nombre erróneo se desactiva (no se borra).
    update core.usuarios set activo = false, profesional_id = null where id = cuenta_can;
    update core.sesiones set revocada_at = now() where usuario_id = cuenta_can and revocada_at is null;
    insert into audit.registro (usuario_id, rol, accion, entidad, entidad_id, detalle)
    values (null, 'sistema', 'usuario.consolidado', 'usuario', cuenta_can::text,
            jsonb_build_object('migracion', '008', 'motivo', 'Misma persona: cuenta con nombre erróneo desactivada; sesiones revocadas',
                               'profesional_anterior', 'zally-pamela', 'cuenta_activa', cuenta_dup));
  end if;
  if cuenta_dup is not null then
    update core.usuarios set profesional_id = 'zally-pamela', nombre = 'Sally Tinizaray Soriano' where id = cuenta_dup;
    insert into audit.registro (usuario_id, rol, accion, entidad, entidad_id, detalle)
    values (null, 'sistema', 'usuario.vinculado', 'usuario', cuenta_dup::text,
            jsonb_build_object('migracion', '008', 'antes', 'sally-tinizaray', 'despues', 'zally-pamela', 'motivo', 'Consolidación de identidad Sally Tinizaray Soriano'));
  elsif cuenta_can is not null then
    update core.usuarios set nombre = 'Sally Tinizaray Soriano' where id = cuenta_can;
  end if;

  insert into audit.registro (usuario_id, rol, accion, entidad, entidad_id, detalle)
  values (null, 'sistema', 'profesional.consolidado', 'profesional', 'zally-pamela',
          jsonb_build_object('migracion', '008', 'duplicado', 'sally-tinizaray', 'referencias_movidas', movidos,
                             'conservados_por_alias', jsonb_build_object(
                               'clinical.adendas', (select count(*) from clinical.adendas where autor_profesional_id = 'sally-tinizaray'),
                               'clinical.expediente_secciones', (select count(*) from clinical.expediente_secciones where autor_profesional_id = 'sally-tinizaray'),
                               'social.intervenciones', (select count(*) from social.intervenciones where profesional_id = 'sally-tinizaray'),
                               'clinical.entradas_validadas', (select count(*) from clinical.entradas where autor_profesional_id = 'sally-tinizaray'))));
end $$;

-- Si nunca existió el duplicado, igual queda constancia de la corrección del nombre.
insert into audit.registro (usuario_id, rol, accion, entidad, entidad_id, detalle)
select null, 'sistema', 'profesional.nombre_corregido', 'profesional', 'zally-pamela',
       '{"migracion":"008","antes":"Zally Pamela","despues":"Sally Tinizaray Soriano"}'::jsonb
 where exists (select 1 from core.profesionales where id = 'zally-pamela');

-- ===================== 2. Teleatención =====================
alter table ops.atenciones drop constraint if exists atenciones_estado_check;
alter table ops.atenciones add constraint atenciones_estado_check
  check (estado in ('pendiente','programada','confirmada','contacto_iniciado','en_atencion','atendida','reprogramada','no_realizada'));
-- Modalidad con la que se realizó (registro de la atención telemática). Solo canales reales disponibles hoy.
alter table ops.atenciones add column if not exists modalidad text check (modalidad in ('videollamada_whatsapp'));
alter table ops.atenciones add column if not exists contacto_iniciado_at timestamptz;
alter table ops.atenciones add column if not exists contacto_iniciado_por uuid references core.usuarios(id);

-- Número de WhatsApp autorizado por la persona para su atención (cifrado; solo se guardan aparte los 4 últimos dígitos
-- para mostrarlo enmascarado). Sin autorización registrada no hay botón de contacto.
alter table ops.servidores add column if not exists whatsapp_cifrado text;
alter table ops.servidores add column if not exists whatsapp_ultimos text;
alter table ops.servidores add column if not exists whatsapp_autorizado_at timestamptz;
alter table ops.servidores add column if not exists whatsapp_autorizado_por uuid references core.usuarios(id);
alter table ops.servidores add column if not exists whatsapp_fuente text check (whatsapp_fuente in ('solicitud_publica','registro_institucional'));

alter table ops.solicitudes_atencion add column if not exists whatsapp_cifrado text;
alter table ops.solicitudes_atencion add column if not exists autoriza_whatsapp boolean not null default false;
