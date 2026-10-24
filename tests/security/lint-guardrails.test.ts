import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";

const eslint = new ESLint();
const ruleIds = async (filePath: string, code: string) =>
  (await eslint.lintText(code, { filePath }))[0].messages.map((message) => message.ruleId);

describe("integration lint guardrails", () => {
  it("rejects adapter casts in Activities", async () => {
    const file = "src/temporal/activities/example.ts";
    expect(await ruleIds(file, "declare const value: unknown;\ninterface SyntheticEchoAdapter { echo(): void }\nexport const adapter = value as SyntheticEchoAdapter;\n"))
      .toContain("no-restricted-syntax");
    expect(await ruleIds(file, "declare const value: unknown;\ntype AdapterFor<K> = K;\nexport const adapter = value as AdapterFor<\"synthetic.echo\">;\n"))
      .toContain("no-restricted-syntax");
    expect(await ruleIds(file, "declare const value: unknown;\nexport const record = value as Record<string, unknown>;\n"))
      .not.toContain("no-restricted-syntax");
  });

  it("only applies the adapter-cast ban to Activity code", async () => {
    expect(await ruleIds("src/services/example.service.ts", "declare const value: unknown;\ninterface SyntheticEchoAdapter { echo(): void }\nexport const adapter = value as SyntheticEchoAdapter;\n"))
      .not.toContain("no-restricted-syntax");
  });
});
