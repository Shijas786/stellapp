import { loadCircuit } from "./artifacts.js";
import { CircuitProver } from "./prover.js";

process.on("message", async (msg: any) => {
  console.log("[Worker] Received message:", JSON.stringify(msg));
  const { taskType, args } = msg;
  try {
    if (taskType === "confidential_token_prove") {
      const { circuitName, inputs } = args;
      console.log("[Worker] Loading circuit:", circuitName);
      const prover = new CircuitProver(loadCircuit(circuitName));
      console.log("[Worker] Proving with inputs:", JSON.stringify(inputs));
      const result = await prover.prove(inputs);
      console.log("[Worker] Proving complete!");
      await prover.destroy();
      process.send!({ success: true, result });
      process.exit(0);
    } 
    else {
      throw new Error(`Unknown task type: ${taskType}`);
    }
  } catch (err: any) {
    console.error("[Worker Error]", err);
    process.send!({ success: false, error: err.stack || err.message || err });
    process.exit(1);
  }
});
