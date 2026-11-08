-- Consulta pública del estado de una solicitud de atención (servidores sin cuenta).
-- Al enviar el formulario se entrega una clave de consulta una sola vez; aquí se guarda solo su HMAC,
-- nunca la clave. La consulta devuelve únicamente la etapa del trámite: ningún dato personal ni clínico.
alter table ops.solicitudes_atencion add column if not exists clave_consulta_hash text;
