import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

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

/**
 * Resolve the repository root. On Vercel, if the dashboard is deployed from
 * apps/dashboard, the Python packages under services/ and workflows/ at the
 * repo root are not part of the deployment. The build step copies them into
 * apps/dashboard/.python_modules, and we fall back to that location.
 */
function repoRoot() {
  if (process.env.SANTOOS_REPO_ROOT) {
    return process.env.SANTOOS_REPO_ROOT;
  }
  // Auto-detect copied modules (used when deploying apps/dashboard standalone).
  const copiedModules = path.join(process.cwd(), ".python_modules");
  if (fs.existsSync(path.join(copiedModules, "services", "scheduler", "corte_santo_cron.py"))) {
    return copiedModules;
  }
  return process.cwd();
}

function pythonBin() {
  return process.env.PYTHON_BIN || process.env.PYTHON || "python";
}

function limited(value: string) {
  const max = 40_000;
  return value.length > max ? `${value.slice(0, max)}\n...[truncated]` : value;
}

function formatIsoNoMs(date: Date) {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function yesterdayIso() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split("T")[0];
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
  const writeMode = url.searchParams.get("write") || process.env.SANTO_CRON_WRITE || "false";
  const isLive = writeMode === "true" || writeMode === "1";

  const args = ["--job", job];

  // Agent-mail needs an --after timestamp to avoid reprocessing old messages.
  if (job === "agent-mail" || job === "all") {
    const after = url.searchParams.get("after") || process.env.CORTE_SANTO_AGENTMAIL_AFTER;
    if (after) {
      args.push("--after", after);
    } else {
      const lookbackMinutes = parseInt(
        process.env.CORTE_SANTO_AGENTMAIL_LOOKBACK_MINUTES || "15",
        10,
      );
      const afterDate = new Date(Date.now() - lookbackMinutes * 60 * 1000);
      args.push("--after", formatIsoNoMs(afterDate));
    }
  }

  // Bank-watcher needs a business date; default to yesterday if unset.
  if (job === "bank-watcher" || job === "all") {
    const businessDate =
      url.searchParams.get("business_date") ||
      process.env.CORTE_SANTO_BANK_WATCH_DATE ||
      yesterdayIso();
    args.push("--business-date", businessDate);
  }

  if (isLive) {
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
      writeMode: isLive ? "live" : "dry_run",
    },
    { status: statusCode },
  );
}
