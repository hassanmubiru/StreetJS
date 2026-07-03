import { writeFileSync } from "node:fs";
import { generateWorkflow, generateActivity } from "../dist/cli/generators.js";

const wf = generateWorkflow("OrderProcessing", ".");
const act = generateActivity("ChargeCard", ".");
writeFileSync(new URL("./OrderProcessingWorkflow.ts", import.meta.url), wf.contents);
writeFileSync(new URL("./ChargeCardActivity.ts", import.meta.url), act.contents);
console.log("wrote:", wf.path, act.path);
