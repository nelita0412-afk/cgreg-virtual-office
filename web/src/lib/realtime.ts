import { useSyncExternalStore } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { EventoPublico, PresenciaSnapshot, Topic } from '@shared/domain';

export type EstadoConexion = 'conectando' | 'conectado' | 'reconectando' | 'desconectado';

/** Qué consultas se invalidan al recibir un evento de cada tema. */
const INVALIDA: Record<Topic, string[]> = {
  presencia: ['resumen', 'panel-pro', 'indicadores'],
  agenda: ['agenda', 'atenciones', 'resumen', 'panel-pro', 'profesionales', 'franjas'],
  atenciones: ['atenciones', 'agenda', 'resumen', 'panel-pro', 'indicadores', 'servidor', 'atencion'],
  derivaciones: ['derivaciones', 'derivacion', 'resumen', 'indicadores', 'panel-coord'],
  solicitudes: ['solicitudes', 'solicitud', 'panel-coord', 'resumen'],
  notificaciones: ['notificaciones'],
  actividades: ['debriefings', 'capacitaciones', 'articulaciones', 'resumen', 'panel-coord'],
  servidores: ['servidores', 'servidor', 'indicadores', 'panel-coord'],
  sync: ['sync'],
  necesidades: ['necesidades', 'servidor', 'indicadores'],
  seguimientos: ['seguimientos', 'panel-pro', 'indicadores'],
  expedientes: ['expediente', 'atencion', 'servidor', 'indicadores'],
  consentimientos: ['consentimientos', 'servidor', 'expediente', 'indicadores'],
  abierta: ['abierta', 'servidores', 'indicadores', 'panel-coord'],
  prioritaria: ['prioritaria', 'servidores', 'servidor', 'indicadores'],
};

class Realtime {
  private ws: WebSocket | null = null;
  private hb: number | null = null;
  private retry = 0;
  private stopped = true;
  private listeners = new Set<() => void>();
  estado: EstadoConexion = 'desconectado';
  ultimoHeartbeat: string | null = null;
  qc: QueryClient | null = null;
  onUnauthorized: (() => void) | null = null;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private set(e: EstadoConexion) {
    this.estado = e;
    this.listeners.forEach((l) => l());
  }

  start(qc: QueryClient) {
    this.qc = qc;
    if (!this.stopped) return;
    this.stopped = false;
    this.open();
  }

  stop() {
    this.stopped = true;
    if (this.hb) clearInterval(this.hb);
    this.ws?.close(1000);
    this.ws = null;
    this.set('desconectado');
  }

  private open() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.set(this.retry ? 'reconectando' : 'conectando');
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.set('conectado');
      if (this.hb) clearInterval(this.hb);
      this.hb = window.setInterval(() => ws.readyState === ws.OPEN && ws.send(JSON.stringify({ t: 'hb' })), 10_000);
    };
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      const qc = this.qc!;
      if (msg.type === 'hola') {
        // Recuperación de estado tras (re)conexión: se vuelve a pedir todo al backend.
        qc.invalidateQueries();
      } else if (msg.type === 'hb') {
        this.ultimoHeartbeat = msg.ts;
        this.listeners.forEach((l) => l());
      } else if (msg.type === 'presencia') {
        qc.setQueryData<PresenciaSnapshot[]>(['presencia'], msg.data);
      } else if (msg.type === 'evento') {
        const ev = msg.evento as EventoPublico;
        for (const k of INVALIDA[ev.topic] ?? []) qc.invalidateQueries({ queryKey: [k] });
        if (ev.texto) qc.setQueryData<EventoPublico[]>(['eventos'], (old) => [ev, ...(old ?? []).filter((x) => x.id !== ev.id)].slice(0, 40));
      }
    };
    ws.onclose = (e) => {
      if (this.hb) clearInterval(this.hb);
      this.ws = null;
      if (e.code === 4401) {
        this.stopped = true;
        this.set('desconectado');
        this.onUnauthorized?.();
        return;
      }
      if (this.stopped) return;
      this.retry++;
      this.set('reconectando');
      const delay = Math.min(30_000, 1000 * 2 ** Math.min(this.retry, 5)) * (0.75 + Math.random() * 0.5);
      setTimeout(() => !this.stopped && this.open(), delay);
    };
  }
}

export const realtime = new Realtime();

export function useConexion() {
  return useSyncExternalStore(realtime.subscribe, () => realtime.estado);
}
