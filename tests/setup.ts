import { vi } from "vitest";
// Unit tests never inherit an application's database destination.
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://unit:unit@127.0.0.1:1/unit_test_no_database";
process.env.JWT_SECRET = "test-secret-0000000000000000";

vi.mock("../src/lib/prisma.js", () => ({
  closeDatabase: async () => {},
  prisma: new Proxy({}, {
    get(_target, name) {
      if (name === "$disconnect") return async () => {};
      if (name === "then") return undefined;
      const fail = () => { throw new Error("Unexpected database access in unit test; mock the model"); };
      return new Proxy(fail, { get() { return fail; } });
    },
  }),
}));
