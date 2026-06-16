import { spawn } from "node:child_process";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

type CronResult = {
  status: "completed" | "requires_review";
  command: string[];
  stdout: string;
  stderr: string;
  exitCode: number | null;
};

const VALID_JOBS = new Set(["agent-mail", "bank-watcher", "all"]);

function repoRoot() {
  return process.env.SANTOOS_REPO_ROOT || process.cwd();
}

function pythonBin() {
  return process.env.PYTHON_BIN || process.env.PYTHON || "python";
}

function limited(value: string) {
  const max = 40_000;
  return value.length > max ? `${value.slice(0, max)}\n...[truncated]` : value;
}

function runCronProcess(args: string[], cwd: string): Promise<CronResult> {
  return new Promise((resolve) => {
    const command = ["-m", "services.scheduler.corte_santo_cron", ...args];
    const pythonPathDelimiter = process.platform === "win32" ? ";" : ":";
    const pythonPackages = `${process.cwd()}/.python_packages`;
    const child = spawn(pythonBin(), command, {
      cwd,
      env: {
        ...process.env,
        PYTHONPATH: [cwd, pythonPackages, process.env.PYTHONPATH]
          .filter(Boolean)
          .join(pythonPathDelimiter),
      },
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      resolve({
        status: "requires_review",
        command,
        stdout: limited(stdout),
        stderr: limited(`${stderr}\n${error.message}`),
        exitCode: null,
      });
    });
    child.on("close", (code) => {
      resolve({
        status: code === 0 ? "completed" : "requires_review",
        command,
        stdout: limited(stdout),
        stderr: limited(stderr),
        exitCode: code,
      });
    });
  });
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json(
      { status: "requires_review", reason: "cron_secret_missing" },
      { status: 503 },
    );
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(request.url);
  const requestedJob = url.searchParams.get("job") || process.env.SANTO_CRON_DEFAULT_JOB || "agent-mail";
  const job = VALID_JOBS.has(requestedJob) ? requestedJob : "all";
  const businessDate = url.searchParams.get("business_date") || process.env.CORTE_SANTO_BANK_WATCH_DATE;
  const writeMode = url.searchParams.get("write") || process.env.SANTO_CRON_WRITE || "false";

  const args = ["--job", job];
  if (businessDate) {
    args.push("--business-date", businessDate);
  }
  if (writeMode === "true" || writeMode === "1") {
    args.push("--write");
  }

  const cwd = repoRoot();
  const result = await runCronProcess(args, cwd);
  const statusCode = result.status === "completed" ? 200 : 207;
  return Response.json(
    {
      ...result,
      cwd,
      job,
      writeMode: writeMode === "true" || writeMode === "1" ? "live" : "dry_run",
    },
    { status: statusCode },
  );
}
