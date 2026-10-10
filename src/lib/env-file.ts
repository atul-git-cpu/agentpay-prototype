/** Small helpers for reading and updating the local .env file (never committed). */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parse } from "dotenv";

const envPath = new URL("../../.env", import.meta.url);
const examplePath = new URL("../../.env.example", import.meta.url);

export function loadEnvText(): string {
  return existsSync(envPath) ? readFileSync(envPath, "utf8") : readFileSync(examplePath, "utf8");
}

/** True only if the variable has a real (non-blank) value, as dotenv would read it. */
export function hasEnvValue(env: string, name: string): boolean {
  return (parse(env)[name] ?? "").trim().length > 0;
}

/** Sets a variable, replacing every existing line for it (so duplicates can't linger). */
export function setEnvValue(env: string, name: string, value: string): string {
  const lines = env.replace(/\r/g, "").split("\n").filter((l) => !l.startsWith(`${name}=`));
  return `${lines.join("\n").trimEnd()}\n${name}=${value}\n`;
}

export function saveEnvText(env: string): void {
  writeFileSync(envPath, env);
}
