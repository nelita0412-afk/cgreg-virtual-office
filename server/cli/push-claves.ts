import webpush from 'web-push';
// Genera el par de claves VAPID para las notificaciones push. Copie ambas líneas al archivo .env del servidor.
const k = webpush.generateVAPIDKeys();
console.log(`VAPID_PUBLIC_KEY=${k.publicKey}\nVAPID_PRIVATE_KEY=${k.privateKey}\nVAPID_SUBJECT=mailto:soporte@cgreg.gob.ec`);
console.error('\nGuarde VAPID_PRIVATE_KEY como secreto: no la suba al repositorio.');
