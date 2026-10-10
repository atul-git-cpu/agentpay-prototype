/** Small helpers for reading and updating the local .env file (never committed). */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const envPath = new URL("../../.env", import.meta.url);
const examplePath = new URL("../../.env.example", import.meta.url);

export function loadEnvText(): string {
  return existsSync(envPath) ? readFileSync(envPath, "utf8") : readFileSync(examplePath, "utf8");
}

export function hasEnvValue(env: string, name: string): boolean {
  return new RegExp(`^${name}=.+`, "m").test(env);
}

export function setEnvValue(env: string, name: string, value: string): string {
  return new RegExp(`^${name}=`, "m").test(env)
    ? env.replace(new RegExp(`^${name}=.*$`, "m"), `${name}=${value}`)
    : `${env.trimEnd()}\n${name}=${value}\n`;
}

export function saveEnvText(env: string): void {
  writeFileSync(envPath, env);
}
