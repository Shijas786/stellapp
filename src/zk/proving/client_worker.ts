import { spawn } from 'child_process';
import path from 'path';

export function runZKWorker(taskType: string, args: any): Promise<any> {
  return new Promise((resolve, reject) => {
    // __dirname points to the folder containing this file
    const isDist = __dirname.includes('dist');
    const filename = isDist ? 'zk_worker.js' : 'zk_worker.ts';
    const workerPath = path.join(__dirname, filename);

    console.log(`[ZK Worker] Spawning ZK background worker at ${workerPath}`);

    const cmd = "nice";
    const cmdArgs = [
      "-n",
      "19",
      isDist ? "node" : "npx",
      ...(isDist ? [workerPath] : ["tsx", workerPath])
    ];

    const child = spawn(cmd, cmdArgs, {
      stdio: ['pipe', 'pipe', 'inherit', 'ipc']
    });

    let finished = false;

    // 5-minute hard deadline — prevents hung workers from stalling the message handler forever
    const ZK_TIMEOUT_MS = 5 * 60 * 1000;
    const timeoutHandle = setTimeout(() => {
      if (!finished) {
        finished = true;
        child.kill();
        reject(new Error(`[ZK Worker] Timed out after ${ZK_TIMEOUT_MS / 1000}s — worker killed`));
      }
    }, ZK_TIMEOUT_MS);

    const cleanup = () => clearTimeout(timeoutHandle);

    child.on('message', (msg: any) => {
      cleanup();
      finished = true;
      if (msg.success) {
        resolve(msg.result);
      } else {
        reject(new Error(msg.error));
      }
      child.kill();
    });

    child.on('error', (err) => {
      cleanup();
      if (!finished) {
        finished = true;
        reject(err);
      }
      child.kill();
    });

    child.on('exit', (code) => {
      cleanup();
      if (!finished) {
        finished = true;
        reject(new Error(`ZK background worker exited unexpectedly with code ${code}`));
      }
    });

    child.send({ taskType, args });
  });
}
