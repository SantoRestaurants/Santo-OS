import { NextRequest, NextResponse } from "next/server";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
const REPO = "SantoRestaurants/Santo-OS";

export async function POST(request: NextRequest) {
    if (!GITHUB_TOKEN) {
        return NextResponse.json(
            { error: "GITHUB_TOKEN not configured. Add it to Vercel environment variables." },
            { status: 500 }
        );
    }

    const body = await request.json().catch(() => null);
    if (!body) {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { workflow, business_date, inputs } = body;

    // Map workflow names to file names
    const workflowMap: Record<string, string> = {
        "agent-mail": "corte-santo-agent-mail.yml",
        "bank-watcher": "corte-santo-bank-watcher.yml",
        "reprocess": "reprocess-corte.yml",
    };

    const workflowFile = workflowMap[workflow];
    if (!workflowFile) {
        return NextResponse.json(
            { error: `Unknown workflow: ${workflow}. Use: ${Object.keys(workflowMap).join(", ")}` },
            { status: 400 }
        );
    }

    // Build the inputs
    const workflowInputs: Record<string, string> = {};
    if (business_date) {
        workflowInputs.business_date = business_date;
    }
    if (inputs && typeof inputs === "object") {
        Object.assign(workflowInputs, inputs);
    }

    // Trigger the workflow via GitHub API
    const url = `https://api.github.com/repos/${REPO}/actions/workflows/${workflowFile}/dispatches`;
    const response = await fetch(url, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${GITHUB_TOKEN}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({
            ref: "main",
            inputs: workflowInputs,
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        return NextResponse.json(
            { error: `GitHub API error: ${response.status} ${errorText}` },
            { status: response.status }
        );
    }

    return NextResponse.json({
        status: "triggered",
        workflow,
        business_date: business_date || null,
        message: `Workflow '${workflow}' triggered successfully.`,
    });
}
