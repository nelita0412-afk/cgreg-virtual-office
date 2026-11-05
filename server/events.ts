import pg from 'pg';
import type { Db, Queryable } from './db';
import type { Topic } from '@shared/domain';

export interface EventRow {
  id: number;
  ts: string;
  tipo: string;
  topic: Topic;
  actor_usuario_id: string | null;
  actor_nombre: string | null;
  texto_publico: string | null;
  destinatarios: string[] | null;
  payload: Record<string, unknown>;
}

export interface EmitInput {
  tipo: string;
  topic: Topic;
  actor?: string | null;
  texto?: string | null;
  destinatarios?: string[] | null;
  payload?: Record<string, unknown>;
}

/**
 * Bus de eventos respaldado por PostgreSQL: cada evento se persiste en ops.eventos y se
 * anuncia con pg_notify dentro de la misma transacción. Solo se difunde cuando la
 * transacción confirma, por lo que nunca se representa una acción no confirmada.
 * Funciona con varias instancias del backend (cada una escucha el canal).
 */
export class EventBus {
  private listeners = new Set<(e: EventRow) => void>();
  private client: pg.Client | null = null;
  private stopped = false;

  constructor(private db: Db, private url: string) {}

  async emit(c: Queryable, e: EmitInput): Promise<number> {
    const r = await c.query<{ id: number }>(
      `insert into ops.eventos (tipo, topic, actor_usuario_id, texto_publico, destinatarios, payload)
       values ($1,$2,$3,$4,$5,$6) returning id`,
      [e.tipo, e.topic, e.actor ?? null, e.texto ?? null, e.destinatarios ?? null, JSON.stringify(e.payload ?? {})],
    );
    const id = r.rows[0].id;
    await c.query(`select pg_notify('cgreg_eventos', $1)`, [String(id)]);
    return id;
  }

  on(fn: (e: EventRow) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  async start() {
    const connect = async () => {
      if (this.stopped) return;
      const client = new pg.Client({ connectionString: this.url });
      client.on('error', () => {
        this.client = null;
        setTimeout(connect, 2000);
      });
      client.on('notification', async (msg) => {
        if (msg.channel !== 'cgreg_eventos' || !msg.payload) return;
        const ev = await this.load(Number(msg.payload));
        if (ev) for (const l of this.listeners) l(ev);
      });
      try {
        await client.connect();
        await client.query('listen cgreg_eventos');
        this.client = client;
      } catch {
        setTimeout(connect, 2000);
      }
    };
    await connect();
  }

  async stop() {
    this.stopped = true;
    await this.client?.end().catch(() => {});
  }

  async load(id: number): Promise<EventRow | null> {
    const r = await this.db.query<EventRow>(
      `select e.id, e.ts, e.tipo, e.topic, e.actor_usuario_id, u.nombre as actor_nombre, e.texto_publico, e.destinatarios, e.payload
         from ops.eventos e left join core.usuarios u on u.id = e.actor_usuario_id where e.id = $1`,
      [id],
    );
    return r.rows[0] ?? null;
  }
}
