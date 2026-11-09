# Teleatención en CGREG Virtual Office

CGREG Virtual Office organiza la atención telemática de principio a fin. **La conversación ocurre por WhatsApp, iniciada manualmente por el profesional.** La plataforma no realiza ni inicia llamadas por sí misma.

## Flujo
1. **Solicitud**: la persona pide atención en el portal (`/servidor` → «Solicitar atención»). Puede dejar un celular para WhatsApp **solo si autoriza expresamente** ese contacto.
2. **Gestión Social**: la solicitud llega a la Coordinación (Coordinación General + Trabajo Social), en «Gestión Social» y «Atención abierta».
3. **Orientación y asignación**: Coordinación orienta, asigna al profesional y se agenda la cita. Si la persona autorizó WhatsApp, el número pasa a su ficha (cifrado).
4. **Consentimiento**: sin consentimiento informado validado no se inicia una atención ordinaria (el protocolo de urgencia queda justificado y auditado).
5. **Contacto**: en la cita, el profesional responsable pulsa **«Contactar por WhatsApp»**. Se abre `https://wa.me/<número autorizado>` con un saludo institucional. La cita pasa a **«Contacto iniciado»** (fecha, hora y profesional registrados).
6. **Videollamada**: el profesional la inicia **manualmente desde WhatsApp**.
7. **Inicio**: pulsa **«Iniciar teleatención»**. La atención pasa a «En atención» con modalidad *videollamada por WhatsApp*.
8. **Registro**: al terminar vuelve a la plataforma y registra la atención por pasos (resumen, evolución, recomendaciones, plan) y el seguimiento.
9. **Coordinación** ve el estado operativo (Programada, Confirmada, Contacto iniciado, En atención, Atendida, No realizada) **sin** acceso al contenido clínico.

## Reglas de protección
- **Número autorizado**: solo se guarda con la autorización expresa de la persona, cifrado. En pantalla aparece enmascarado (`•••• 1234`). Lo registran Coordinación o el profesional asignado, y se puede retirar. La auditoría guarda solo los 4 últimos dígitos.
- **Mensaje inicial**: «Hola, le saluda {profesional}, de la Brigada de Apoyo Psicosocial del CGREG, a propósito de su cita del {fecha} a las {hora} (hora de Galápagos). ¿Puede recibir una videollamada por este medio?». Nunca lleva el nombre de la persona, motivos, diagnósticos, documentos ni información clínica.
- **Solo el profesional responsable** obtiene el enlace (API `POST /api/atenciones/:id/whatsapp`); Coordinación, otros profesionales, Autoridad o Epidemiología reciben 403.
- **Habilitación institucional**: `TELEATENCION_WHATSAPP_HABILITADA=true`. Por defecto está **desactivada**: usar el WhatsApp de los profesionales requiere autorización de la institución. En la demostración está activada.
- **Sin números inventados**: la demostración no trae números; para probar, registre un número propio en un caso de demostración.

## Zona de Telemedicina (3D) ≠ videollamada
La sala de Telemedicina y los consultorios de la Oficina Virtual 3D **muestran quién está en una atención**. No son una videollamada.

## Arquitectura preparada para videollamada propia (WebRTC)
`server/teleatencion.ts` define **canales** (`CANALES`). Hoy existe `whatsapp_manual` (`llamadaAutomatica: false`). Para incorporar una videollamada dentro de CGREG:
1. Agregar un canal `webrtc` con su modalidad (`videollamada_cgreg`) en `CANALES` y en el `check` de `ops.atenciones.modalidad`.
2. Señalización por el WebSocket autenticado existente (`server/realtime.ts`), mensajes dirigidos solo a la persona y al profesional de esa atención.
3. Servidores STUN/TURN institucionales (configuración, sin datos clínicos).
4. Mismo ciclo de estados, auditoría y registro clínico: el resto del sistema no cambia.
