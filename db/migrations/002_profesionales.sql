-- Registro de los ocho profesionales de teleatención y de la colaboradora territorial.
-- Los horarios se almacenan en la zona de origen (America/Guayaquil) y la plataforma
-- los convierte a la hora institucional (Pacific/Galapagos).

insert into core.profesionales (id, nombre, nombre_corto, titulo, especialidad, perfil, experiencia, modalidad, estacion, color, cabello, es_teleatencion, notas_agenda, orden) values
('gabriel-ordonez', 'Gabriel Ordóñez', 'Gabriel', 'Psicólogo clínico', 'psicologia',
 'Psicólogo clínico, magíster en Gestión de Riesgos y Desastres, con más de 18 años de experiencia.',
 array['Atención clínica','Intervención en crisis','Psicología de emergencias','Primeros auxilios psicológicos','Evaluación de daños y necesidades','Gestión pública','Coordinación de emergencias'],
 'Teleatención psicológica', 'psi-1', '#2563eb', '#1f140d', true, null, 1),
('maria-alcivar', 'Ma. de los Ángeles Alcívar C.', 'Ma. de los Ángeles', 'Psicóloga clínica', 'psicologia',
 'Psicóloga clínica, máster en Neuropsicología.',
 array['Atención clínica','Coordinación DECE','Atención a niños, adolescentes, adultos y adultos mayores','Centros integrales de bienestar'],
 'Teleatención psicológica', 'psi-2', '#e2e8f0', '#3b2417', true, null, 2),
('hugo-cuenca', 'Hugo Xavier Cuenca Guerrero', 'Hugo Xavier', 'Psicólogo clínico', 'psicologia',
 'Psicólogo clínico, especialización en Drogodependencias y máster en Neuropsicología y Educación.',
 array['Atención individual','Familias vulnerables','Adicciones','Cuidados paliativos','Grupos terapéuticos','Prevención comunitaria'],
 'Teleatención psicológica', 'psi-3', '#0f766e', '#140d08', true, null, 3),
('sofia-guerra', 'Sofía Guerra', 'Sofía', 'Psicóloga clínica', 'psicologia',
 'Psicóloga clínica con experiencia en comunidad escolar y trabajo sociocomunitario.',
 array['Comunidad escolar','Trabajo sociocomunitario'],
 'Teleatención psicológica', 'psi-4', '#f8fafc', '#5a3a22', true, null, 4),
('betsabe-cordova', 'Betsabé Córdova', 'Betsabé', 'Psicóloga clínica', 'psicologia',
 'Psicóloga clínica, máster en Intervención Psicosocial.',
 array['Atención a niños, adolescentes y adultos','Abordaje de violencias','Adicciones','VIH','Atención en crisis','Trabajo con comunidad LGBTIQ+'],
 'Teleatención psicológica', 'psi-5', '#7c3aed', '#24150c', true, null, 5),
('zally-pamela', 'Zally Pamela', 'Zally Pamela', 'Psicóloga clínica', 'psicologia',
 'Psicóloga clínica, máster en Intervención Familiar y del Adolescente. Diez años de experiencia en DECE y coordinación DECE.',
 array['Educación Especial','Trastornos del Neurodesarrollo','Dificultades del aprendizaje','Ansiedad y depresión','DECE y coordinación DECE'],
 'Teleatención psicológica', 'psi-6', '#db2777', '#2a1a10', true, null, 6),
('demetrio-magallanes', 'Dr. Demetrio Magallanes', 'Demetrio', 'Médico epidemiólogo', 'telemedicina',
 'Médico epidemiólogo con más de diez años en ayuda humanitaria.',
 array['Ayuda humanitaria','Gestión de riesgos','Equipos de pronta respuesta','Actividades vinculadas al IESS','Corporación Kimirina'],
 'Telemedicina (consultas de 20 a 30 minutos)', 'tele', '#f1f5f9', '#4b5563', true, null, 7),
('diego-estrella', 'Dr. Diego Estrella', 'Diego', 'Médico especialista en Psiquiatría', 'psiquiatria',
 'Médico especialista en Psiquiatría. Atención exclusivamente especializada mediante derivación.',
 array['Valoración psiquiátrica','Evaluación de casos derivados','Revisión y confirmación diagnóstica cuando corresponda','Orientación especializada','Recomendaciones y seguimiento especializado'],
 'Psiquiatría por derivación (20 a 30 minutos)', 'psiq', '#1e3a8a', '#111827', true,
 'Sin horario fijo: la agenda se coordina según la disponibilidad que el especialista confirme.', 8),
('andrea-mayorga', 'Andrea Mayorga', 'Andrea', 'Psicóloga — Colaboradora territorial DECE', 'psicologia',
 'Psicóloga vinculada al DECE, desplegada en territorio, brindando acompañamiento y contención a niños, adolescentes y familias afectadas.',
 array['Articulación territorial','Coordinación educativa','Acompañamiento y contención'],
 'Territorial (no forma parte de la teleatención)', 'terr', '#ea580c', '#3a2414', false,
 'Colaboradora territorial: no se contabiliza dentro de los ocho profesionales de teleatención.', 9);

insert into core.disponibilidad (profesional_id, dia_semana, hora_inicio, hora_fin, tz) values
-- Gabriel Ordóñez: lunes, miércoles y viernes 07:00–09:00 (continental)
('gabriel-ordonez', 1, '07:00', '09:00', 'America/Guayaquil'),
('gabriel-ordonez', 3, '07:00', '09:00', 'America/Guayaquil'),
('gabriel-ordonez', 5, '07:00', '09:00', 'America/Guayaquil'),
-- Ma. de los Ángeles Alcívar: lunes 10:00–12:00, martes 14:15–17:00, sábado 10:00–11:00
('maria-alcivar', 1, '10:00', '12:00', 'America/Guayaquil'),
('maria-alcivar', 2, '14:15', '17:00', 'America/Guayaquil'),
('maria-alcivar', 6, '10:00', '11:00', 'America/Guayaquil'),
-- Hugo Xavier Cuenca: miércoles 18:00–20:00, domingo 14:00–17:00
('hugo-cuenca', 3, '18:00', '20:00', 'America/Guayaquil'),
('hugo-cuenca', 7, '14:00', '17:00', 'America/Guayaquil'),
-- Sofía Guerra: martes y jueves 18:00–20:00
('sofia-guerra', 2, '18:00', '20:00', 'America/Guayaquil'),
('sofia-guerra', 4, '18:00', '20:00', 'America/Guayaquil'),
-- Betsabé Córdova: lunes y miércoles 19:00–20:00
('betsabe-cordova', 1, '19:00', '20:00', 'America/Guayaquil'),
('betsabe-cordova', 3, '19:00', '20:00', 'America/Guayaquil'),
-- Zally Pamela: martes y jueves 17:30–20:00
('zally-pamela', 2, '17:30', '20:00', 'America/Guayaquil'),
('zally-pamela', 4, '17:30', '20:00', 'America/Guayaquil'),
-- Demetrio Magallanes: lunes a viernes 19:00–21:00
('demetrio-magallanes', 1, '19:00', '21:00', 'America/Guayaquil'),
('demetrio-magallanes', 2, '19:00', '21:00', 'America/Guayaquil'),
('demetrio-magallanes', 3, '19:00', '21:00', 'America/Guayaquil'),
('demetrio-magallanes', 4, '19:00', '21:00', 'America/Guayaquil'),
('demetrio-magallanes', 5, '19:00', '21:00', 'America/Guayaquil');
-- Dr. Diego Estrella: sin horario fijo (franjas confirmadas en core.franjas_confirmadas).
