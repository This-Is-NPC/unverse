import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { run } from "./consumer.mjs";

export async function withPostgres(action) {
  const directory = mkdtempSync(`${process.env.TMPDIR}/unverse-postgres-`);
  const data = resolve(directory, "data");
  const socket = resolve(directory, "socket");
  let server;
  let exited;
  const interrupt = () => server?.kill("SIGINT");
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  try {
    mkdirSync(socket, { mode: 0o700 });
    run(
      "initdb",
      [
        "-D",
        data,
        "-U",
        "unverse",
        "-A",
        "trust",
        "--locale=C",
        "--encoding=UTF8",
      ],
      directory,
    );
    server = spawn("postgres", ["-D", data, "-h", "", "-k", socket, "-F"], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    exited = new Promise((done) => {
      server.once("close", done);
      server.once("error", done);
    });
    await new Promise((ready, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Disposable PostgreSQL did not become ready.")),
        30_000,
      );
      let transcript = "";
      server.stderr.on("data", (chunk) => {
        appendFileSync(resolve(directory, "postgres.log"), chunk);
        transcript += chunk.toString();
        if (transcript.includes("ready to accept connections")) {
          clearTimeout(timer);
          ready();
        }
      });
      server.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      server.once("exit", () => {
        clearTimeout(timer);
        reject(new Error("Disposable PostgreSQL exited before readiness."));
      });
    });
    return await action({
      host: socket,
      port: 5432,
      user: "unverse",
      database: "postgres",
      ssl: false,
    });
  } finally {
    try {
      server?.kill("SIGINT");
      await exited;
    } finally {
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", interrupt);
      rmSync(directory, { recursive: true, force: true });
    }
  }
}
