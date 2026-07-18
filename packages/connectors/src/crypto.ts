import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM cipher for connector credentials (SECURITY_MODEL.md §5).
 * The key comes from CONNECTOR_SECRETS_KEY (64 hex chars = 32 bytes) and in
 * GCP lives in Secret Manager. Ciphertext format: v1:<iv>:<tag>:<data> (b64).
 */
export class SecretCipher {
  private readonly key: Buffer;

  constructor(hexKey: string) {
    if (!/^[0-9a-fA-F]{64}$/.test(hexKey)) {
      throw new Error('CONNECTOR_SECRETS_KEY must be 64 hex characters (32 bytes)');
    }
    this.key = Buffer.from(hexKey, 'hex');
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${data.toString('base64')}`;
  }

  decrypt(ciphertext: string): string {
    const [version, ivB64, tagB64, dataB64] = ciphertext.split(':');
    if (version !== 'v1' || !ivB64 || !tagB64 || !dataB64) {
      throw new Error('Unrecognized ciphertext format');
    }
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }
}

/** Stored (encrypted) credential payload for a connector account. */
export interface StoredCredentials {
  kind: 'oauth_tokens' | 'api_key';
  accessToken?: string;
  refreshToken?: string;
  /** Epoch millis when accessToken expires. */
  expiresAt?: number;
  apiKey?: string;
  /** Extra provider-specific fields (e.g. Slack team id, IMAP host). */
  extra?: Record<string, string>;
}

/**
 * Persistence port for encrypted credentials. The database package provides
 * the row store; this composes it with the cipher so raw tokens never touch
 * the database or logs.
 */
export interface SecretRowStore {
  insert(organizationId: string, ciphertext: string): Promise<string>;
  get(organizationId: string, id: string): Promise<string | null>;
  update(organizationId: string, id: string, ciphertext: string): Promise<void>;
  remove(organizationId: string, id: string): Promise<void>;
}

export class DbSecretsStore {
  constructor(
    private readonly rows: SecretRowStore,
    private readonly cipher: SecretCipher,
  ) {}

  async store(organizationId: string, credentials: StoredCredentials): Promise<string> {
    const id = await this.rows.insert(
      organizationId,
      this.cipher.encrypt(JSON.stringify(credentials)),
    );
    return `local:${id}`;
  }

  async retrieve(organizationId: string, ref: string): Promise<StoredCredentials | null> {
    const id = ref.startsWith('local:') ? ref.slice(6) : ref;
    const ciphertext = await this.rows.get(organizationId, id);
    if (!ciphertext) return null;
    return JSON.parse(this.cipher.decrypt(ciphertext)) as StoredCredentials;
  }

  async update(organizationId: string, ref: string, credentials: StoredCredentials): Promise<void> {
    const id = ref.startsWith('local:') ? ref.slice(6) : ref;
    await this.rows.update(organizationId, id, this.cipher.encrypt(JSON.stringify(credentials)));
  }

  async delete(organizationId: string, ref: string): Promise<void> {
    const id = ref.startsWith('local:') ? ref.slice(6) : ref;
    await this.rows.remove(organizationId, id);
  }
}
