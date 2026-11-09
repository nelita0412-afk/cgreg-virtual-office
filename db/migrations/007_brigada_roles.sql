-- Reorganización de la Brigada de Apoyo Psicosocial (noviembre 2026).
-- Cambios ADITIVOS: no borra usuarios, profesionales ni datos. Todo cambio de rol queda en audit.registro.
--  1. Rol base nuevo «epidemiologia» (Apoyo Epidemiológico y Territorial) y especialidad «epidemiologia».
--  2. Funciones complementarias combinables por usuario (una persona, una cuenta, varias funciones).
--  3. Directorio oficial: nombres completos, profesión, experiencia, función en la Brigada e instituciones
--     de vinculación (solo descriptivas: no otorgan permisos).
--  4. Registros nuevos: Lic. Marianella del Cisne Becerra Hernández (Coordinación · Trabajo Social) y
--     Sally Tinizaray Soriano (Psicología Clínica). Sally es un registro propio: no se vincula con ningún otro.

-- 1. Rol y especialidad -----------------------------------------------------------------------------------------
alter table core.usuarios drop constraint if exists usuarios_rol_check;
alter table core.usuarios add constraint usuarios_rol_check
  check (rol in ('admin','coordinacion','profesional','territorial','autoridad','auditoria','trabajo_social','epidemiologia'));
alter table core.profesionales drop constraint if exists profesionales_especialidad_check;
alter table core.profesionales add constraint profesionales_especialidad_check
  check (especialidad in ('psicologia','telemedicina','psiquiatria','trabajo_social','epidemiologia'));

-- 2. Funciones complementarias ------------------------------------------------------------------------------------
create table if not exists core.usuario_funciones (
  id           bigserial primary key,
  usuario_id   uuid not null references core.usuarios(id),
  funcion      text not null check (funcion in ('trabajo_social','territorial','gestion_operativa')),
  motivo       text not null,
  otorgada_por uuid references core.usuarios(id),
  otorgada_at  timestamptz not null default now(),
  revocada_por uuid references core.usuarios(id),
  revocada_at  timestamptz
);
create unique index if not exists usuario_funciones_activa_uq on core.usuario_funciones (usuario_id, funcion) where revocada_at is null;

-- 3. Directorio --------------------------------------------------------------------------------------------------
alter table core.profesionales add column if not exists funcion_brigada text;
alter table core.profesionales add column if not exists instituciones text[] not null default '{}';
alter table core.profesionales add column if not exists en_directorio boolean not null default true;
alter table core.profesionales add column if not exists nota_directorio text;

update core.profesionales set nombre = 'Gabriel Alexander Ordóñez Guzmán', titulo = 'Psicólogo Clínico',
  perfil = 'Psicólogo clínico con experiencia en salud mental, emergencias y gestión pública.',
  funcion_brigada = 'Profesional de Salud Mental' where id = 'gabriel-ordonez';
update core.profesionales set nombre = 'Sofía Fernanda Guerra Reyna', titulo = 'Psicóloga Clínica',
  perfil = 'Psicóloga clínica con experiencia en intervención comunitaria y educativa.',
  experiencia = array['Intervención comunitaria','Intervención educativa','Comunidad escolar'],
  funcion_brigada = 'Profesional de Salud Mental' where id = 'sofia-guerra';
update core.profesionales set nombre = 'Betsabé Córdova Wellington', titulo = 'Psicóloga Clínica',
  perfil = 'Psicóloga clínica, especialista en intervención psicosocial.',
  experiencia = array['Intervención en crisis','Violencia','Adicciones','VIH','Intervención psicosocial'],
  funcion_brigada = 'Profesional de Salud Mental' where id = 'betsabe-cordova';
update core.profesionales set nombre = 'Andrea Mayorga Molina', titulo = 'Psicóloga',
  perfil = 'Psicóloga con experiencia en acompañamiento y contención de niños, adolescentes y familias afectadas por emergencias.',
  experiencia = array['Acompañamiento y contención','Niños, adolescentes y familias','Emergencias','Articulación territorial'],
  funcion_brigada = 'Profesional de Salud Mental · Función territorial' where id = 'andrea-mayorga';
update core.profesionales set nombre = 'Diego Estrella Almeida', titulo = 'Médico Psiquiatra',
  perfil = 'Médico psiquiatra: valoración y orientación clínica especializada en salud mental.',
  funcion_brigada = 'Psiquiatría' where id = 'diego-estrella';
update core.profesionales set nombre = 'María de los Ángeles Alcívar Condo', titulo = 'Psicóloga Clínica',
  perfil = 'Psicóloga clínica, máster en Neuropsicología. Atención a niños, adolescentes, adultos y adultos mayores.',
  funcion_brigada = 'Profesional de Salud Mental' where id = 'maria-alcivar';
update core.profesionales set nombre = 'Hugo Xavier Cuenca Guerrero', titulo = 'Psicólogo Clínico',
  perfil = 'Psicólogo clínico, especialista en Drogodependencias, magíster en Neuropsicología y Educación.',
  experiencia = array['Adicciones','Intervención familiar','Drogodependencias','Neuropsicología y educación'],
  funcion_brigada = 'Profesional de Salud Mental' where id = 'hugo-cuenca';
update core.profesionales set nombre = 'Demetrio Magallanes Manzaba', titulo = 'Médico Epidemiólogo',
  especialidad = 'epidemiologia', es_teleatencion = false, modalidad = 'Apoyo epidemiológico y territorial',
  perfil = 'Médico epidemiólogo con experiencia en ayuda humanitaria, gestión de riesgos y equipos de pronta respuesta.',
  experiencia = array['Ayuda humanitaria','Gestión de riesgos','Equipos de pronta respuesta'],
  instituciones = array['IESS','Corporación Kimirina'],
  funcion_brigada = 'Apoyo Epidemiológico y Territorial' where id = 'demetrio-magallanes';

-- Registro previo que no figura en el directorio oficial: se conserva intacto (cuenta, citas e historias),
-- fuera del directorio y marcado para revisión de la Coordinación. No se fusiona con ningún otro registro.
update core.profesionales set en_directorio = false,
  nota_directorio = 'No figura en el directorio oficial de la Brigada (noviembre 2026). Registro conservado; pendiente de confirmación por la Coordinación.'
  where id = 'zally-pamela';

-- 4. Registros nuevos ----------------------------------------------------------------------------------------------
insert into core.profesionales (id, nombre, nombre_corto, titulo, especialidad, perfil, experiencia, modalidad, estacion, color, cabello, es_teleatencion, notas_agenda, orden, funcion_brigada)
values
('sally-tinizaray', 'Sally Tinizaray Soriano', 'Sally', 'Psicóloga Clínica', 'psicologia',
 'Psicóloga clínica, magíster en Intervención Familiar y del Adolescente.',
 array['Educación Especial','Trastornos del Neurodesarrollo','Intervención familiar y del adolescente'],
 'Teleatención psicológica', 'psi-7', '#78958A', '#2a1a10', true, 'Horario por confirmar con la Coordinación.', 6,
 'Profesional de Salud Mental'),
('marianella-becerra', 'Lic. Marianella del Cisne Becerra Hernández, Espc.', 'Marianella', 'Trabajadora Social · Especialista en Gestión de la Salud Digital', 'trabajo_social',
 'Coordinadora de la Brigada de Apoyo Psicosocial del CGREG. Trabajadora Social, especialista en Gestión de la Salud Digital.',
 array['Coordinación General de la Brigada','Trabajo social','Gestión de la salud digital','Articulación interdisciplinaria e institucional'],
 'Coordinación General · Trabajo Social', 'coord', '#34483F', '#2b1d14', false, null, 0,
 'Coordinación General · Trabajo Social')
on conflict (id) do nothing;

-- 5. Cuentas existentes cuyo rol cambia con la nueva matriz (explícito y auditado) ------------------------------
-- Andrea: la función territorial se suma a sus permisos de Psicología (no los reemplaza).
with cambio as (
  update core.usuarios set rol = 'profesional' where profesional_id = 'andrea-mayorga' and rol = 'territorial' returning id
), f as (
  insert into core.usuario_funciones (usuario_id, funcion, motivo)
  select id, 'territorial', 'Migración 007: Profesional de Salud Mental con función territorial adicional (directorio oficial).' from cambio
  on conflict do nothing returning usuario_id
)
insert into audit.registro (usuario_id, rol, accion, entidad, entidad_id, detalle)
select null, 'sistema', 'usuario.rol_reorganizado', 'usuario', id::text,
       '{"migracion":"007","antes":"territorial","despues":"profesional","funciones_agregadas":["territorial"]}'::jsonb from cambio;

-- Demetrio: Apoyo Epidemiológico y Territorial, sin permisos clínicos por defecto.
with cambio as (
  update core.usuarios set rol = 'epidemiologia' where profesional_id = 'demetrio-magallanes' and rol = 'profesional' returning id
)
insert into audit.registro (usuario_id, rol, accion, entidad, entidad_id, detalle)
select null, 'sistema', 'usuario.rol_reorganizado', 'usuario', id::text,
       '{"migracion":"007","antes":"profesional","despues":"epidemiologia"}'::jsonb from cambio;

-- 6. Colores de avatar acordes con la identidad visual (sin azul dominante).
update core.profesionales set color = '#4D665C' where id = 'gabriel-ordonez' and color = '#2563eb';
update core.profesionales set color = '#3D5249' where id = 'diego-estrella' and color = '#1e3a8a';
