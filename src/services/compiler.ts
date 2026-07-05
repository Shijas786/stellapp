import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import crypto from "crypto";

const execFilePromise = promisify(execFile);
const COMPILER_DIR = path.join(process.cwd(), "compiler_template");
const MAX_RUST_SOURCE_BYTES = 128 * 1024;
const MAX_WASM_BYTES = 64 * 1024;
const COMPILATION_TIMEOUT_MS = 120_000;
const MAX_COMPILER_OUTPUT_BYTES = 1024 * 1024;

/**
 * Removes Rust comments and whitespace to make validation resistant to tokens
 * separated by comments or formatting.
 */
function compactRustSource(source: string): string {
  let result = "";
  let index = 0;
  let blockCommentDepth = 0;

  while (index < source.length) {
    if (blockCommentDepth > 0) {
      if (source.startsWith("/*", index)) {
        blockCommentDepth++;
        index += 2;
      } else if (source.startsWith("*/", index)) {
        blockCommentDepth--;
        index += 2;
      } else {
        index++;
      }
      continue;
    }

    if (source.startsWith("//", index)) {
      const newlineIndex = source.indexOf("\n", index + 2);
      index = newlineIndex === -1 ? source.length : newlineIndex + 1;
      continue;
    }

    if (source.startsWith("/*", index)) {
      blockCommentDepth = 1;
      index += 2;
      continue;
    }

    const character = source[index];
    if (!/\s/u.test(character)) {
      result += character;
    }
    index++;
  }

  if (blockCommentDepth !== 0) {
    throw new Error("Rust source contains an unterminated block comment.");
  }

  return result;
}

function validateRustSource(rustCode: string): void {
  if (typeof rustCode !== "string" || rustCode.trim().length === 0) {
    throw new Error("Rust source must be a non-empty string.");
  }

  if (Buffer.byteLength(rustCode, "utf8") > MAX_RUST_SOURCE_BYTES) {
    throw new Error(
      `Rust source exceeds the ${MAX_RUST_SOURCE_BYTES}-byte limit.`
    );
  }

  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(rustCode)) {
    throw new Error("Rust source contains prohibited control characters.");
  }

  if (
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
      rustCode
    )
  ) {
    throw new Error("Rust source contains invalid Unicode.");
  }

  const compactSource = compactRustSource(rustCode);
  const prohibitedConstructs: Array<{
    pattern: RegExp;
    description: string;
  }> = [
    {
      pattern: /(?:r#)?include(?:_str|_bytes)?!/u,
      description: "compile-time file inclusion"
    },
    {
      pattern: /(?:r#)?(?:option_)?env!/u,
      description: "compile-time environment access"
    },
    {
      pattern: /#\[(?:[^\]]*,)?path=/u,
      description: "custom module paths"
    },
    {
      pattern: /#!?\[(?:[^\]]*,)?crate_type=/u,
      description: "crate type overrides"
    },
    {
      pattern: /#!?\[(?:[^\]]*,)?link(?:_name|_ordinal)?=/u,
      description: "custom native linking"
    }
  ];

  for (const prohibited of prohibitedConstructs) {
    if (prohibited.pattern.test(compactSource)) {
      throw new Error(
        `Rust source contains prohibited ${prohibited.description}.`
      );
    }
  }
}

function createCompilerEnvironment(
  sharedTargetDir: string
): NodeJS.ProcessEnv {
  const allowedEnvironmentVariables = [
    "PATH",
    "HOME",
    "USERPROFILE",
    "SystemRoot",
    "WINDIR",
    "PATHEXT",
    "TEMP",
    "TMP",
    "TMPDIR",
    "RUSTUP_HOME",
    "CARGO_HOME"
  ] as const;

  const environment: NodeJS.ProcessEnv = {};

  for (const variable of allowedEnvironmentVariables) {
    const value = process.env[variable];
    if (value !== undefined) {
      environment[variable] = value;
    }
  }

  return {
    ...environment,
    CARGO_TARGET_DIR: sharedTargetDir,
    CARGO_NET_OFFLINE: "true",
    CARGO_BUILD_JOBS: "1",
    CARGO_INCREMENTAL: "0",
    RUST_BACKTRACE: "0"
  };
}

function getSafeCompilerError(error: unknown): string {
  let message = "Cargo compilation failed.";

  if (error && typeof error === "object") {
    const candidate = error as {
      stderr?: string | Buffer;
      message?: string;
      killed?: boolean;
      signal?: string;
    };

    if (candidate.killed || candidate.signal === "SIGKILL") {
      message = "Cargo compilation exceeded the allowed execution time.";
    } else if (candidate.stderr) {
      message = candidate.stderr.toString();
    } else if (candidate.message) {
      message = candidate.message;
    }
  } else if (typeof error === "string") {
    message = error;
  }

  return message
    .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/gu, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, "")
    .slice(-400);
}

/**
 * Asynchronously compiles a custom Soroban smart contract (Rust) into WASM bytecode.
 * Uses an isolated temp directory per request to avoid clobbering, while setting
 * CARGO_TARGET_DIR to share build artifacts (incremental compilation).
 */
export async function compileRustContractAsync(
  rustCode: string
): Promise<Buffer> {
  validateRustSource(rustCode);

  const id = crypto.randomBytes(16).toString("hex");
  const scratchDir = path.join(process.cwd(), "scratch");
  fs.mkdirSync(scratchDir, { recursive: true, mode: 0o700 });

  const tempDir = fs.mkdtempSync(path.join(scratchDir, `compiler_${id}_`));
  fs.chmodSync(tempDir, 0o700);

  const tempSrcDir = path.join(tempDir, "src");
  const sharedTargetDir = path.join(COMPILER_DIR, "target");
  const wasmPath = path.join(
    sharedTargetDir,
    "wasm32v1-none",
    "release",
    `soroban_custom_compiler_${id}.wasm`
  );

  console.log(`[Compiler] Setting up isolated compiler workspace: ${tempDir}`);

  try {
    fs.mkdirSync(tempSrcDir, { recursive: false, mode: 0o700 });

    // 1. Copy and customize Cargo.toml to use a unique package name
    const templateCargoPath = path.join(COMPILER_DIR, "Cargo.toml");
    const templateLockPath = path.join(COMPILER_DIR, "Cargo.lock");

    if (!fs.existsSync(templateLockPath)) {
      throw new Error(
        "Compiler template is missing Cargo.lock; locked compilation is required."
      );
    }

    let cargoToml = fs.readFileSync(templateCargoPath, "utf8");
    // Replace the name so that Cargo outputs a uniquely named .wasm file
    const originalPackageName = 'name = "soroban-custom-compiler"';
    if (!cargoToml.includes(originalPackageName)) {
      throw new Error("Compiler template contains an unexpected package name.");
    }

    cargoToml = cargoToml.replace(
      originalPackageName,
      `name = "soroban_custom_compiler_${id}"`
    );

    fs.writeFileSync(path.join(tempDir, "Cargo.toml"), cargoToml, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx"
    });
    fs.copyFileSync(
      templateLockPath,
      path.join(tempDir, "Cargo.lock"),
      fs.constants.COPYFILE_EXCL
    );

    // 2. Write the custom Rust code to lib.rs
    fs.writeFileSync(path.join(tempSrcDir, "lib.rs"), rustCode, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx"
    });

    // 3. Execute Cargo build target wasm32v1-none asynchronously
    console.log(
      "[Compiler] Triggering async Cargo build with shared target cache..."
    );

    try {
      await execFilePromise(
        "cargo",
        [
          "build",
          "--target",
          "wasm32v1-none",
          "--release",
          "--offline",
          "--jobs",
          "1"
        ],
        {
          cwd: tempDir,
          env: createCompilerEnvironment(sharedTargetDir),
          timeout: COMPILATION_TIMEOUT_MS,
          killSignal: "SIGKILL",
          maxBuffer: MAX_COMPILER_OUTPUT_BYTES,
          windowsHide: true,
          shell: false
        }
      );
    } catch (error: unknown) {
      const errorMsg = getSafeCompilerError(error);
      console.error("[Compiler] Cargo compilation error details:", errorMsg);
      throw new Error(`Rust Compilation Error:\n${errorMsg}`);
    }

    // Find the compiled unique wasm file
    let wasmStats: fs.Stats;
    try {
      wasmStats = fs.statSync(wasmPath);
    } catch {
      throw new Error("WASM file was not generated by Cargo build.");
    }

    if (!wasmStats.isFile()) {
      throw new Error("Cargo generated an invalid WASM artifact.");
    }

    if (wasmStats.size > MAX_WASM_BYTES) {
      throw new Error(
        `Compiled WASM exceeds the ${MAX_WASM_BYTES}-byte size limit.`
      );
    }

    const wasmBuffer = fs.readFileSync(wasmPath);

    if (
      wasmBuffer.length < 8 ||
      wasmBuffer[0] !== 0x00 ||
      wasmBuffer[1] !== 0x61 ||
      wasmBuffer[2] !== 0x73 ||
      wasmBuffer[3] !== 0x6d
    ) {
      throw new Error("Cargo generated an invalid WASM binary.");
    }

    console.log("[Compiler] Smart contract built successfully!");
    return wasmBuffer;
  } finally {
    // Clean up: delete temp workspace and the uniquely named wasm artifact
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
      fs.rmSync(wasmPath, { force: true });
    } catch (cleanupError: unknown) {
      const message =
        cleanupError instanceof Error
          ? cleanupError.message
          : "Unknown cleanup error";
      console.warn("[Compiler] Warning: Cleanup failed:", message);
    }
  }
}