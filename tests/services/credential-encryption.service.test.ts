import { describe, it, expect } from "vitest";
import { CredentialEncryptionService } from "../../src/services/credential-encryption.service.js";

describe("CredentialEncryptionService", () => {
  it("encrypts and decrypts credential JSON without storing plaintext", () => {
    const service = new CredentialEncryptionService("test-key-material-12345678901234567890", "v-test");
    const encrypted = service.encrypt({ apiToken: "secret-token" });

    expect(encrypted.credentialCiphertext).not.toContain("secret-token");
    expect(encrypted.credentialKeyVersion).toBe("v-test");
    expect(service.decrypt(encrypted)).toEqual({ apiToken: "secret-token" });
  });

  it("decrypts old credential versions when they remain in the key ring", () => {
    const oldKey = "test-key-material-old-12345678901234567890";
    const newKey = "test-key-material-new-12345678901234567890";
    const writer = new CredentialEncryptionService(oldKey, "v1");
    const reader = new CredentialEncryptionService(newKey, "v2", { v1: oldKey });
    const encrypted = writer.encrypt({ apiToken: "secret-token" });

    expect(reader.decrypt(encrypted)).toEqual({ apiToken: "secret-token" });

    const newEncrypted = reader.encrypt({ apiToken: "new-secret-token" });
    expect(newEncrypted.credentialKeyVersion).toBe("v2");
    expect(reader.decrypt(newEncrypted)).toEqual({ apiToken: "new-secret-token" });
  });

  it("rejects key versions missing from the key ring", () => {
    const writer = new CredentialEncryptionService("test-key-material-old-12345678901234567890", "v1");
    const reader = new CredentialEncryptionService("test-key-material-new-12345678901234567890", "v2");
    const encrypted = writer.encrypt({ apiToken: "secret-token" });

    expect(() => reader.decrypt(encrypted)).toThrow("Integration credential key version is not configured");
  });
});
