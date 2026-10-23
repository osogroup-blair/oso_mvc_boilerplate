import { it,expect } from "vitest";
import { EncryptedPayloadCodec } from "../../src/lib/temporalPayload.js";
it("encrypts payload bytes and authenticates key version, ciphertext and retained-key rotation",async()=>{
 const oldKey="synthetic-old-master-key-0000000000000000",newKey="synthetic-new-master-key-0000000000000000";
 const old=new EncryptedPayloadCodec("v1",{v1:oldKey});const rotated=new EncryptedPayloadCodec("v2",{v1:oldKey,v2:newKey});
 const payload={metadata:{encoding:Buffer.from("json/plain")},data:Buffer.from('"PRIVATE DOCUMENT PAYLOAD"')};
 const [encrypted]=await old.encode([payload]);expect(Buffer.from(encrypted.data!).toString()).not.toContain("PRIVATE DOCUMENT PAYLOAD");
 expect(Buffer.from((await rotated.decode([encrypted]))[0].data!).toString()).toContain("PRIVATE DOCUMENT PAYLOAD");
 const [fresh]=await rotated.encode([payload]);expect(Buffer.from(fresh.metadata!.keyVersion).toString()).toBe("v2");
 await expect(new EncryptedPayloadCodec("v2",{v2:newKey}).decode([encrypted])).rejects.toThrow();
 const tampered={...encrypted,data:Buffer.from(encrypted.data!)};tampered.data[30]^=1;await expect(rotated.decode([tampered])).rejects.toThrow();
 await expect(new EncryptedPayloadCodec("v2",{v2:newKey},true,false).decode([payload])).rejects.toThrow("encoding");
});
