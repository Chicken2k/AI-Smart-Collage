
import { GoogleGenAI, Type } from "@google/genai";

// Safely access API Key to prevent ReferenceError in browser environments where 'process' is undefined
const getApiKey = () => {
  try {
    return typeof process !== 'undefined' ? process.env.API_KEY : '';
  } catch (e) {
    return '';
  }
};

const apiKey = getApiKey();
const ai = new GoogleGenAI({ apiKey: apiKey });

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const callAIWithRetry = async (prompt: string, retryCount = 0): Promise<any> => {
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.0-flash',
            contents: prompt,
            config: {
                temperature: 0.3,
                responseMimeType: 'application/json',
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        filename: { type: Type.STRING }
                    }
                }
            }
        });
        return response;
    } catch (error: any) {
        if (retryCount < 5) {
            const waitTime = 15000 * (retryCount + 1); // 15s, 30s...
            console.warn(`SmartNaming Busy, waiting ${waitTime/1000}s...`);
            await wait(waitTime);
            return callAIWithRetry(prompt, retryCount + 1);
        }
        throw error;
    }
};

/**
 * Uses Gemini to generate a clean, SEO-friendly filename based on the post caption.
 */
export const generateSmartMetadata = async (caption: string, username: string): Promise<string> => {
  if (!apiKey) {
    console.warn("No API Key found, skipping smart naming.");
    return `tiktok_${username}_${Date.now()}`;
  }

  try {
    const prompt = `Generate a short, descriptive, file-system safe name (snake_case) based on this TikTok caption. 
      Max 30 characters. Do not include file extension.
      Caption: "${caption}"`;

    const response = await callAIWithRetry(prompt);

    let text = response.text || '{}';
    // Remove markdown code blocks if present (Gemini sometimes wraps JSON in markdown)
    text = text.replace(/```json\n?|```/g, '').trim();

    const json = JSON.parse(text);
    return json.filename || `tiktok_${username}_processed`;

  } catch (error) {
    console.error("Gemini Smart Naming Error:", error);
    return `tiktok_${username}_${Date.now()}`; // Fallback
  }
};
