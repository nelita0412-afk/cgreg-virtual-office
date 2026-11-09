import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DateTime } from 'luxon';
import type { AppCtx, SessionUser } from './context';
import { HttpError, badRequest, conflict, forbidden, notFound } from './context';
import { makeGuards } from './auth';
import { audit } from './audit';
import { tx, type Queryable } from './db';
import { exigirAsignacion, parse, u } from './routes/util';
import { puede } from '@shared/permissions';
import { TZ_INSTITUCIONAL } from '@shared/domain';

/**
 * Teleatención: CGREG Virtual Office organiza la atención telemática de principio a fin, y la conversación ocurre por
 * un CANAL. Hoy existe un único canal real:
 *
 *   whatsapp_manual — la plataforma prepara el enlace oficial «wa.me» con el número que la persona AUTORIZÓ y un mensaje
 *                     institucional breve, sin información clínica. El profesional abre el chat y realiza la videollamada
 *                     manualmente desde WhatsApp. La plataforma NO inicia llamadas ni envía mensajes por sí misma.
 *
 * Preparado para un canal futuro dentro de CGREG (WebRTC) sin reconstruir el sistema: un canal nuevo se agrega a
 * CANALES con su modalidad y su `prepararContacto`; la señalización viajaría por el WebSocket autenticado existente
 * (server/realtime.ts) y la atención sigue el mismo ciclo de estados y registros. Ver docs/TELEATENCION.md.
 */
export type IdCanal = 'whatsapp_manual';
type Canal = {
  id: IdCanal;
  etiqueta: string;
  /** Valor guardado en ops.atenciones.modalidad al iniciar la atención por este canal. */
  modalidad: 'videollamada_whatsapp';
  /** true solo si la plataforma inicia la llamada por sí misma (no es el caso de WhatsApp). */
  llamadaAutomatica: boolean;
  habilitado: (ctx: AppCtx) => boolean;
};
export const CANALES: Record<IdCanal, Canal> = {
  whatsapp_manual: {
    id: 'whatsapp_manual',
    etiqueta: 'Videollamada por WhatsApp (manual)',
    modalidad: 'videollamada_whatsapp',
    llamadaAutomatica: false,
    habilitado: (ctx) => ctx.cfg.TELEATENCION_WHATSAPP_HABILITADA === 'true',
  },
};

/** Celulares de Ecuador (+593 9XXXXXXXX). Acepta 09…, +5939… o 5939…; devuelve 5939XXXXXXXX o null. */
export function normalizarCelularEc(entrada: string): string | null {
  const d = entrada.replace(/[\s\-().]/g, '');
  const m = /^(?:\+?593|0)(9\d{8})$/.exec(d);
  return m ? `593${m[1]}` : null;
}

/** Mensaje inicial institucional: identifica a la Brigada y la cita. Nunca nombres de la persona, motivos ni datos clínicos. */
export function mensajeInicial(nombreProfesional: string, inicio: Date | string | null) {
  const cuando = inicio
    ? ` de su cita del ${DateTime.fromJSDate(new Date(inicio)).setZone(TZ_INSTITUCIONAL).setLocale('es').toFormat("d 'de' LLLL 'a las' HH:mm")} (hora de Galápagos)`
    : '';
  return `Hola, le saluda ${nombreProfesional}, de la Brigada de Apoyo Psicosocial del CGREG, a propósito${cuando}. ¿Puede recibir una videollamada por este medio?`;
}

export const enmascarar = (ultimos: string | null) => (ultimos ? `•••• ${ultimos}` : null);

/** Guarda el número autorizado (cifrado). Solo con autorización expresa de la persona. */
export async function guardarWhatsapp(c: Queryable, ctx: AppCtx, servidorId: string, numero: string, fuente: 'solicitud_publica' | 'registro_institucional', usuarioId: string | null) {
  await c.query(
    `update ops.servidores set whatsapp_cifrado = $2, whatsapp_ultimos = $3, whatsapp_autorizado_at = now(), whatsapp_autorizado_por = $4, whatsapp_fuente = $5 where id = $1`,
    [servidorId, ctx.cipher.encrypt(numero), numero.slice(-4), usuarioId, fuente],
  );
}

export function teleatencionRoutes(app: FastifyInstance, ctx: AppCtx) {
  const { requirePerm, requireAuth } = makeGuards(ctx);
  const db = ctx.db;

  /** Quién puede registrar o retirar el número: Coordinación o el profesional asignado al caso. */
  async function exigirGestionContacto(c: Queryable, user: SessionUser, servidorId: string) {
    if (puede(user, 'servidores.asignar')) return;
    if (!puede(user, 'servidores.ver_asignados')) throw forbidden();
    await exigirAsignacion(c, user, servidorId);
  }

  app.get('/api/teleatencion/config', { preHandler: requireAuth }, async () => ({
    canales: Object.values(CANALES).map((k) => ({ id: k.id, etiqueta: k.etiqueta, habilitado: k.habilitado(ctx), llamada_automatica: k.llamadaAutomatica })),
  }));

  app.put('/api/servidores/:id/whatsapp', { preHandler: requirePerm('servidores.asignar', 'servidores.ver_asignados') }, async (req) => {
    const user = u(req);
    const { id } = req.params as { id: string };
    const b = parse(z.object({ numero: z.string().trim().min(9).max(20), autorizado: z.literal(true) }), req.body);
    const numero = normalizarCelularEc(b.numero);
    if (!numero) throw badRequest('Ingrese un celular de Ecuador válido (por ejemplo, 09 9999 9999).');
    await tx(db, async (c) => {
      await exigirGestionContacto(c, user, id);
      await guardarWhatsapp(c, ctx, id, numero, 'registro_institucional', user.id);
      await audit(c, user, 'servidor.whatsapp_autorizado', 'servidor', id, { terminacion: numero.slice(-4) }, req.ip);
    });
    return { ok: true, terminacion: enmascarar(numero.slice(-4)) };
  });

  app.delete('/api/servidores/:id/whatsapp', { preHandler: requirePerm('servidores.asignar', 'servidores.ver_asignados') }, async (req) => {
    const user = u(req);
    const { id } = req.params as { id: string };
    await tx(db, async (c) => {
      await exigirGestionContacto(c, user, id);
      await c.query(
        `update ops.servidores set whatsapp_cifrado = null, whatsapp_ultimos = null, whatsapp_autorizado_at = null, whatsapp_autorizado_por = null, whatsapp_fuente = null where id = $1`,
        [id],
      );
      await audit(c, user, 'servidor.whatsapp_retirado', 'servidor', id, {}, req.ip);
    });
    return { ok: true };
  });

  /**
   * Prepara el contacto por WhatsApp de una cita: solo el profesional responsable, con el canal habilitado por la
   * institución y con un número autorizado por la persona. Devuelve el enlace «wa.me» (lo abre el profesional) y deja
   * la atención en «Contacto iniciado». No se envía nada desde el servidor.
   */
  app.post('/api/atenciones/:id/whatsapp', { preHandler: requirePerm('atenciones.registrar') }, async (req) => {
    const user = u(req);
    const { id } = req.params as { id: string };
    parse(z.object({}).strict(), req.body ?? {});
    if (!CANALES.whatsapp_manual.habilitado(ctx)) {
      throw new HttpError(503, 'La teleatención por WhatsApp no está habilitada por la institución.', 'whatsapp_no_habilitado');
    }
    return tx(db, async (c) => {
      const at = (await c.query(
        `select a.id, a.codigo, a.estado, a.inicio, a.profesional_id, a.servidor_id, p.nombre_corto, p.nombre as profesional_nombre, s.whatsapp_cifrado, s.whatsapp_ultimos
           from ops.atenciones a join core.profesionales p on p.id = a.profesional_id join ops.servidores s on s.id = a.servidor_id where a.id = $1`,
        [id],
      )).rows[0];
      if (!at) throw notFound('Atención no encontrada');
      if (user.rol !== 'profesional' || user.profesional_id !== at.profesional_id) throw forbidden('Solo el profesional responsable contacta a la persona.');
      if (!['programada', 'confirmada', 'contacto_iniciado', 'en_atencion'].includes(at.estado)) throw conflict('La cita no admite contacto en su estado actual.');
      if (!at.whatsapp_cifrado) throw conflict('La persona no tiene un número de WhatsApp autorizado para su atención.', 'sin_whatsapp_autorizado');
      const numero = ctx.cipher.decrypt(at.whatsapp_cifrado);
      const mensaje = mensajeInicial(at.nombre_corto ?? at.profesional_nombre, at.inicio);
      if (['programada', 'confirmada'].includes(at.estado)) {
        await c.query(`update ops.atenciones set estado = 'contacto_iniciado', contacto_iniciado_at = now(), contacto_iniciado_por = $2, updated_at = now() where id = $1`, [id, user.id]);
        await c.query(`insert into ops.atencion_historial (atencion_id, estado_anterior, estado_nuevo, actor, nota_operativa) values ($1,$2,'contacto_iniciado',$3,'Contacto por WhatsApp iniciado por el profesional')`, [id, at.estado, user.id]);
        await ctx.bus.emit(c, { tipo: 'atencion.contacto_iniciado', topic: 'atenciones', actor: user.id, texto: 'Se inició el contacto de una teleatención.' });
      }
      await audit(c, user, 'teleatencion.contacto_whatsapp', 'atencion', id, { canal: 'whatsapp_manual', terminacion: at.whatsapp_ultimos }, req.ip);
      return { url: `https://wa.me/${numero}?text=${encodeURIComponent(mensaje)}`, mensaje, terminacion: enmascarar(at.whatsapp_ultimos), canal: 'whatsapp_manual' };
    });
  });
}

