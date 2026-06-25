import { NextResponse } from "next/server";
import { saveManualCorrection } from "../../actions";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    await saveManualCorrection(formData);
    // saveManualCorrection redirects on success/error, so we shouldn't reach here 
    // unless an unexpected error is thrown that it doesn't catch.
    return NextResponse.json({ success: true });
  } catch (error: any) {
    // If it's a redirect error from next/navigation, let it throw so Next.js handles it.
    if (error?.message === "NEXT_REDIRECT") {
      throw error;
    }
    return NextResponse.json({ error: error.message || "Failed to process correction" }, { status: 500 });
  }
}
