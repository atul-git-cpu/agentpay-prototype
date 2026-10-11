/**
 * Completes fiat payouts whose (mock) partner leg is due, writing e-FIRA / SEPA / ACH / MT103 documents.
 *   npm run payouts:advance                      only payouts whose expected time has passed
 *   npm run payouts:advance -- --fast-forward    complete all now (demo: skip the T+2 wait)
 */
import "dotenv/config";
import { getDatabase } from "../db/client.js";
import { advancePayouts } from "./engine.js";

const fastForward = process.argv.includes("--fast-forward");
const db = getDatabase();
const { completed, waiting } = await advancePayouts(db, { fastForward, log: (s) => console.log(s) });
console.log(`\n${completed} completed, ${waiting} still waiting${waiting ? " (add -- --fast-forward to skip the wait in a demo)" : ""}.`);
console.log("See documents with `npm run ledger`.");
await db.close();
