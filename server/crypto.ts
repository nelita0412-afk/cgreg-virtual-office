import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

/**
 * Cifrado de campos clínicos con AES-256-GCM.
 * Formato: v1.<iv b64>.<tag b64>.<datos b64>. El prefijo de versión permite rotar claves.
 */
export class FieldCipher {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new Error('La clave de cifrado debe tener 32 bytes');
  }
  static fromBase64(b64: string) {
    return new FieldCipher(Buffer.from(b64, 'base64'));
  }
  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), data.toString('base64')].join('.');
  }
  decrypt(payload: string): string {
    const [v, iv, tag, data] = payload.split('.');
    if (v !== 'v1') throw new Error('Versión de cifrado no soportada');
    const d = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
  }
  /** Archivos: [0x01][iv 12][tag 16][datos] */
  encryptBuffer(plain: Buffer): Buffer {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([c.update(plain), c.final()]);
    return Buffer.concat([Buffer.from([1]), iv, c.getAuthTag(), data]);
  }
  decryptBuffer(payload: Buffer): Buffer {
    if (payload[0] !== 1) throw new Error('Versión de cifrado no soportada');
    const d = createDecipheriv('aes-256-gcm', this.key, payload.subarray(1, 13));
    d.setAuthTag(payload.subarray(13, 29));
    return Buffer.concat([d.update(payload.subarray(29)), d.final()]);
  }
  encryptJson(o: unknown) {
    return this.encrypt(JSON.stringify(o));
  }
  decryptJson<T>(p: string | null | undefined): T | null {
    return p ? (JSON.parse(this.decrypt(p)) as T) : null;
  }
}

export function sha256(s: string | Buffer) {
  return createHash('sha256').update(s).digest('hex');
}

export function newToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}
