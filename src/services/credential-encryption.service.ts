import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { BaseService } from "./BaseService.js";
import { config } from "../config/index.js";
import { AppError } from "../lib/AppError.js";

export interface EncryptedCredentialEnvelope {
  credentialCiphertext: string;
  credentialIv: string;
  credentialAuthTag: string;
  credentialKeyVersion: string;
  credentialFingerprint: string;
}

export type CredentialKeyRing = Record<string, string>;

export class CredentialEncryptionService extends BaseService {
  private readonly keysByVersion: ReadonlyMap<string, string>;

  constructor(
    private readonly activeKeyMaterial: string = config.INTEGRATION_CREDENTIAL_KEY,
    private readonly activeKeyVersion: string = config.INTEGRATION_CREDENTIAL_KEY_VERSION,
    keyRing: CredentialKeyRing = config.INTEGRATION_CREDENTIAL_KEY_RING
  ) {
    super("CredentialEncryptionService");
    this.keysByVersion = new Map([
      ...Object.entries(keyRing),
      [this.activeKeyVersion, this.activeKeyMaterial],
    ]);
  }

  encrypt(value: Record<string, unknown>): EncryptedCredentialEnvelope {
    const plaintext = Buffer.from(JSON.stringify(value), "utf8");
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key(this.activeKeyMaterial), iv);
    cipher.setAAD(Buffer.from(this.activeKeyVersion, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return {
      credentialCiphertext: ciphertext.toString("base64url"),
      credentialIv: iv.toString("base64url"),
      credentialAuthTag: authTag.toString("base64url"),
      credentialKeyVersion: this.activeKeyVersion,
      credentialFingerprint: this.fingerprint(value, this.activeKeyMaterial),
    };
  }

  decrypt(envelope: {
    credentialCiphertext: string;
    credentialIv: string;
    credentialAuthTag: string;
    credentialKeyVersion: string;
  }): Record<string, unknown> {
    const keyMaterial = this.keysByVersion.get(envelope.credentialKeyVersion);
    if (!keyMaterial) throw AppError.conflict("Integration credential key version is not configured");

    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        this.key(keyMaterial),
        Buffer.from(envelope.credentialIv, "base64url")
      );
      decipher.setAAD(Buffer.from(envelope.credentialKeyVersion, "utf8"));
      decipher.setAuthTag(Buffer.from(envelope.credentialAuthTag, "base64url"));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(envelope.credentialCiphertext, "base64url")),
        decipher.final(),
      ]);
      const parsed = JSON.parse(plaintext.toString("utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw AppError.badRequest("Integration credentials decrypted to an invalid shape");
      }
      return parsed as Record<string, unknown>;
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw AppError.forbidden("Integration credentials could not be decrypted");
    }
  }

  redacted() {
    return { credentials: "[redacted]" };
  }

  private key(keyMaterial: string) {
    return createHash("sha256").update(keyMaterial).digest();
  }

  private fingerprint(value: Record<string, unknown>, keyMaterial: string) {
    return createHmac("sha256", this.key(keyMaterial)).update(JSON.stringify(value)).digest("hex").slice(0, 24);
  }
}

export const credentialEncryptionService = new CredentialEncryptionService();
