import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname, "../.."),
  outputFileTracingIncludes: {
    "/api/cron/santo": [
      "../../services/**/*",
      "../../workflows/corte_santo/**/*",
      "../../pyproject.toml",
    ],
  },
};

export default nextConfig;
