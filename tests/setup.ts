// Global test setup. Force test env so config validation uses test values.
import dotenv from "dotenv";
dotenv.config();

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ||= "postgresql://boilerplate:boilerplate@localhost:5436/boilerplate?schema=public";
process.env.JWT_SECRET ||= "test-secret-0000000000000000";
