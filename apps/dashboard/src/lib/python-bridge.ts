/**
 * Bridge to call Python AI question answering system
 * 
 * This module provides a TypeScript interface to the Python question answering system.
 * It handles data transformation and error handling between TypeScript and Python.
 */

interface QuestionAnswerResult {
    answer: string;
    confidence: number;
}

interface QuestionContext {
    business_date?: string;
    unit?: string;
    restaurant_id?: string;
}

/**
 * Answer a financial question using the Python AI system
 * 
 * @param question The question text in Spanish
 * @param context Context information (business_date, unit, etc.)
 * @returns Answer with confidence score
 */
export async function answerQuestion(
    question: string,
    context: QuestionContext
): Promise<QuestionAnswerResult> {
    try {
        // For now, we'll implement this as a direct call to Python via child_process
        // or through an API endpoint. This is a placeholder that shows the interface.

        // TODO: Implement actual Python bridge
        // Options:
        // 1. Use child_process to spawn Python script
        // 2. Use a microservice endpoint
        // 3. Use PyNode or similar bridge

        // For MVP, we can call Python via exec
        const { execSync } = require("child_process");

        const payload = JSON.stringify({
            question,
            context,
        });

        // Call Python script with JSON input
        const pythonScript = `
import json
import sys
import asyncio
from services.ai.questions import QuestionAnswerer

async def main():
    # Parse input
    data = json.loads(sys.argv[1])
    
    # TODO: Initialize Supabase client from environment
    # For now, this is a placeholder
    supabase_client = None
    
    # Create answerer
    answerer = QuestionAnswerer(supabase_client)
    
    # Answer question
    result = await answerer.answer(data['question'], data['context'])
    
    # Output result
    print(json.dumps(result))

if __name__ == "__main__":
    asyncio.run(main())
`;

        // This is a simplified version - actual implementation would be more robust
        throw new Error("Python bridge not yet implemented - use fallback to Claude/Gemini");

    } catch (error) {
        console.error("Error calling Python question answerer:", error);
        return {
            answer: "",
            confidence: 0.0,
        };
    }
}

/**
 * Check if a question can be answered by the pattern-matching system
 * 
 * @param question The question text
 * @returns true if the question matches a known pattern
 */
export function isKnownQuestion(question: string): boolean {
    const q = question.toLowerCase();

    // Quick pattern matching for the 25 known questions
    // This is a simplified version - the Python system has more sophisticated matching

    const patterns = [
        // Q1-Q4: Deposits
        /american express.*deposit.*hoy/,
        /banorte.*deposit.*hoy/,
        /falta.*american express/,
        /falta.*banorte/,

        // Q5: CxC percentage
        /porcentaje.*cuentas por cobrar/,

        // Q6-Q10: Cash and tips
        /efectivo.*propinas.*entre/,
        /efectivo real.*ventas.*entre/,
        /cortesías.*dirección/,
        /deposit.*propinas.*ingresos/,
        /porcentaje.*propinas.*ventas/,

        // Q11-Q14: Monthly deposits and pending
        /american express.*depositado/,
        /banorte.*depositado/,
        /cierre.*american express.*pendientes/,
        /cierre.*banorte.*pendiente/,

        // Q15-Q17: Cross-month and commissions
        /ingresos depositados.*mayo/,
        /dinero ingresó.*mayo.*american express/,
        /porcentaje.*comisión.*american express/,

        // Q18-Q25: Platforms
        /monto total.*ventas.*uber/,
        /monto total.*ventas.*rappi/,
        /monto total.*depósitos.*uber/,
        /monto total.*depósitos.*rappi/,
        /porcentaje.*comisiones.*uber/,
        /porcentaje.*comisiones.*rappi/,
        /porcentaje.*ventas totales.*uber/,
        /porcentaje.*ventas totales.*rappi/,
    ];

    return patterns.some(pattern => pattern.test(q));
}
