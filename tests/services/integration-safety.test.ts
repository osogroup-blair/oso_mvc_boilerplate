import { describe, it, expect } from "vitest";
import {
  IntegrationTimeoutError,
  MAX_INTEGRATION_MESSAGE_LENGTH,
  runWithTimeout,
  scrubIntegrationMessage,
} from "../../src/integrations/safety.js";

describe("integration safety helpers", () => {
  it("scrubs nested credential values, longest first, and caps message length", () => {
    const message = scrubIntegrationMessage(
      `auth failed for key-abcdef (prefix key-abc) pin 98765 ${"x".repeat(400)}`,
      { apiKey: "key-abcdef", nested: { prefix: "key-abc", pin: 98765, short: "ab" } }
    );
    expect(message).not.toMatch(/key-abc|98765/);
    expect(message.startsWith("auth failed for [redacted] (prefix [redacted]) pin [redacted]")).toBe(true);
    expect(message.length).toBe(MAX_INTEGRATION_MESSAGE_LENGTH);
  });

  it("applies provider redaction after credential scrubbing", () => {
    expect(scrubIntegrationMessage("id 1234-5678 token zzzz", { token: "zzzz" }, (text) => text.replace(/\d{4}-\d{4}/, "[account]")))
      .toBe("id [account] token [redacted]");
  });

  it("aborts and rejects operations that exceed the timeout", async () => {
    let signalAborted = false;
    await expect(runWithTimeout((signal) => new Promise((resolve) => {
      signal.addEventListener("abort", () => { signalAborted = true; resolve("late"); });
    }), 20)).rejects.toBeInstanceOf(IntegrationTimeoutError);
    expect(signalAborted).toBe(true);
  });

  it("returns the operation result when it finishes in time", async () => {
    await expect(runWithTimeout(async () => "done", 1000)).resolves.toBe("done");
  });
});
