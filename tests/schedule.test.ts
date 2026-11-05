import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { expandirReglas, resumenSemanalInstitucional, validarCita, franjasLibres } from '@shared/schedule';
import { can } from '@shared/permissions';

const G = 'America/Guayaquil';
const reglas = {
  gabriel: [1, 3, 5].map((d) => ({ dia_semana: d, hora_inicio: '07:00', hora_fin: '09:00', tz: G })),
  maria: [
    { dia_semana: 1, hora_inicio: '10:00', hora_fin: '12:00', tz: G },
    { dia_semana: 2, hora_inicio: '14:15', hora_fin: '17:00', tz: G },
    { dia_semana: 6, hora_inicio: '10:00', hora_fin: '11:00', tz: G },
  ],
  hugo: [
    { dia_semana: 3, hora_inicio: '18:00', hora_fin: '20:00', tz: G },
    { dia_semana: 7, hora_inicio: '14:00', hora_fin: '17:00', tz: G },
  ],
  zally: [2, 4].map((d) => ({ dia_semana: d, hora_inicio: '17:30', hora_fin: '20:00', tz: G })),
  demetrio: [1, 2, 3, 4, 5].map((d) => ({ dia_semana: d, hora_inicio: '19:00', hora_fin: '21:00', tz: G })),
};
const ref = new Date('2026-11-04T12:00:00Z');

describe('Conversión Ecuador continental → Galápagos', () => {
  it('Gabriel: lun, mié y vie 06:00–08:00', () => {
    const r = resumenSemanalInstitucional(reglas.gabriel, 'Pacific/Galapagos', ref);
    expect(r).toEqual([
      { dia_semana: 1, dia: 'Lunes', rangos: ['06:00–08:00'] },
      { dia_semana: 3, dia: 'Miércoles', rangos: ['06:00–08:00'] },
      { dia_semana: 5, dia: 'Viernes', rangos: ['06:00–08:00'] },
    ]);
  });
  it('Ma. de los Ángeles: lun 09:00–11:00; mar 13:15–16:00; sáb 09:00–10:00', () => {
    const r = resumenSemanalInstitucional(reglas.maria, 'Pacific/Galapagos', ref);
    expect(r.map((x) => [x.dia_semana, x.rangos])).toEqual([
      [1, ['09:00–11:00']],
      [2, ['13:15–16:00']],
      [6, ['09:00–10:00']],
    ]);
  });
  it('Hugo: mié 17:00–19:00; dom 13:00–16:00', () => {
    const r = resumenSemanalInstitucional(reglas.hugo, 'Pacific/Galapagos', ref);
    expect(r.map((x) => [x.dia_semana, x.rangos])).toEqual([
      [3, ['17:00–19:00']],
      [7, ['13:00–16:00']],
    ]);
  });
  it('Zally: mar y jue 16:30–19:00 · Demetrio: lun–vie 18:00–20:00', () => {
    expect(resumenSemanalInstitucional(reglas.zally, 'Pacific/Galapagos', ref).map((x) => x.rangos[0])).toEqual(['16:30–19:00', '16:30–19:00']);
    const d = resumenSemanalInstitucional(reglas.demetrio, 'Pacific/Galapagos', ref);
    expect(d).toHaveLength(5);
    expect(new Set(d.map((x) => x.rangos[0]))).toEqual(new Set(['18:00–20:00']));
  });
  it('los intervalos absolutos conservan el instante real', () => {
    const ivs = expandirReglas(reglas.gabriel.slice(0, 1), new Date('2026-11-09T00:00:00Z'), new Date('2026-11-10T00:00:00Z'));
    expect(ivs[0].start!.toUTC().toISO()).toBe('2026-11-09T12:00:00.000Z'); // 07:00 GYE = 12:00 UTC = 06:00 GAL
  });
});

describe('Reglas de agenda', () => {
  const ahora = new Date('2026-11-01T00:00:00Z');
  const disp = expandirReglas(reglas.demetrio, new Date('2026-11-09T00:00:00Z'), new Date('2026-11-10T06:00:00Z'));
  const lunes18Gal = DateTime.fromISO('2026-11-09T18:00', { zone: 'Pacific/Galapagos' }).toJSDate();
  it('acepta una cita de telemedicina de 30 min dentro de la disponibilidad', () => {
    expect(validarCita({ inicio: lunes18Gal, duracionMin: 30, especialidad: 'telemedicina', disponibilidad: disp, ahora })).toBeNull();
  });
  it('rechaza duraciones no permitidas', () => {
    expect(validarCita({ inicio: lunes18Gal, duracionMin: 45, especialidad: 'telemedicina', disponibilidad: disp, ahora })).toBe('duracion_no_permitida');
    expect(validarCita({ inicio: lunes18Gal, duracionMin: 20, especialidad: 'psicologia', disponibilidad: disp, ahora })).toBe('duracion_no_permitida');
  });
  it('rechaza citas que exceden la franja', () => {
    const tarde = DateTime.fromISO('2026-11-09T19:45', { zone: 'Pacific/Galapagos' }).toJSDate();
    expect(validarCita({ inicio: tarde, duracionMin: 30, especialidad: 'telemedicina', disponibilidad: disp, ahora })).toBe('fuera_de_disponibilidad');
  });
  it('franjas libres excluye bloques ocupados', () => {
    const libres = franjasLibres({ disponibilidad: disp, ocupados: [{ inicio: lunes18Gal, fin: new Date(lunes18Gal.getTime() + 30 * 60_000) }], duracionMin: 30, ahora });
    expect(libres.map((d) => d.toISOString())).not.toContain(lunes18Gal.toISOString());
    expect(libres.length).toBeGreaterThan(0);
  });
});

describe('Permisos', () => {
  it('la autoridad ve indicadores agregados pero no expedientes ni solicitudes', () => {
    expect(can('autoridad', 'indicadores.agregados')).toBe(true);
    expect(can('autoridad', 'clinico.leer_propio')).toBe(false);
    expect(can('autoridad', 'servidores.ver_todos')).toBe(false);
    expect(can('autoridad', 'solicitudes.gestionar')).toBe(false);
  });
  it('coordinación no tiene acceso clínico', () => {
    expect(can('coordinacion', 'clinico.leer_propio')).toBe(false);
    expect(can('coordinacion', 'atenciones.registrar')).toBe(false);
  });
});
