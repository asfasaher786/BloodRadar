import { GoogleGenAI } from "@google/genai";
import { CONFIG } from "../config/config";
import { resolveCity, SUPPORTED_CITIES } from "../config/regions";

let ai: GoogleGenAI | null = null;
if (CONFIG.GEMINI_API_KEY) {
  ai = new GoogleGenAI({
    apiKey: CONFIG.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });
}

const CLINICAL_INSTRUCTIONS = `
You are BloodRadar Triage Coordinator, a clinical decision support system designed specifically to service the twin cities of Rawalpindi and Islamabad, Pakistan.
Your primary objective is managing, advising on, and triaging patient blood requirements, voluntary donor coordination, and healthcare navigation.

PROMPT DIRECTIVES & CLINICAL COMPLIANCE:
- If the user has a medical emergency or requires immediate blood, classify this as a high urgency case. Advise them to use the SOS request form in our web platform immediately or dial the emergency Helpline +92 51 1122.
- Provide real nearby hospital insights based on Rawalpindi/Islamabad geography (e.g., Holy Family Hospital, BBH, PIMS, Shifa International) and recommend matching blood groups if they specify a recipient blood group!
- Keep your description clear and formatting clean with standard Markdown bullet points.
`;

export async function askGemini(
  message: string,
  history: { sender: 'user' | 'ai'; text: string }[],
  language: "en" | "ur",
  isEmergencyAlert: boolean,
  classifierLabel: string,
  classifierConfidence: number
): Promise<string> {
  if (ai) {
    try {
      const metadataInstruction = `\n[CLASSIFIER METADATA - Patient Intent: "${classifierLabel}" with ${classifierConfidence}% confidence score. Tailor your answer specifically to address this parsed intent with clinical precision].`;
      const instructions = CLINICAL_INSTRUCTIONS + metadataInstruction;

      const historyPrompt = history.slice(-5).map(m => 
        `${m.sender === 'user' ? 'Patient' : 'BloodRadar'}: ${m.text}`
      ).join("\n");
      const completePrompt = `${historyPrompt}\nPatient: ${message}\nBloodRadar:`;

      const response = await ai.models.generateContent({
        model: "gemini-1.5-flash",
        contents: completePrompt,
        config: {
          systemInstruction: instructions,
          temperature: 0.7,
        }
      });

      return response.text || "I am processing your query. Please locate the donor list or SOS request on our dashboard for immediate matching.";
    } catch (err) {
      console.error("Gemini API generation error:", err);
      return getFallbackResponse(message, language, isEmergencyAlert);
    }
  }

  return getFallbackResponse(message, language, isEmergencyAlert);
}

// Real, honest AI use: unlike the strict regex parser, this handles messy,
// real-world phrasing (e.g. "need b positive urgent isb", "O negative chahye
// rawalpindi ASAP"). Falls back to null on any failure so the caller can
// give an honest "couldn't understand" reply rather than guessing wrong.
const VALID_GROUPS_FOR_PARSING = ["O+", "O-", "A+", "A-", "B+", "B-", "AB+", "AB-"];

export async function parseEmergencyTextWithAI(text: string): Promise<{ bloodGroup?: string; city?: string } | null> {
  if (!ai || !text || !text.trim()) return null;

  try {
    const instruction = `You extract structured data from a short, possibly messy SMS text asking for emergency blood in Rawalpindi or Islamabad, Pakistan. The sender may write in English, Urdu, Roman Urdu, or a mix, and may misspell things or use shorthand ("isb", "rwp", "b+", "o negative", "chahiye").
Respond with ONLY a JSON object, no other text, in exactly this shape:
{"bloodGroup": one of "O+","O-","A+","A-","B+","B-","AB+","AB-" or null if unclear, "city": one of ${JSON.stringify(SUPPORTED_CITIES)} (default to "${SUPPORTED_CITIES[0]}" if not mentioned)}
Do not include any explanation, markdown formatting, or extra text — only the raw JSON object.`;

    const response = await ai.models.generateContent({
      model: "gemini-1.5-flash",
      contents: text,
      config: { systemInstruction: instruction, temperature: 0 }
    });

    const raw = (response.text || "").trim().replace(/^```json\s*|```$/g, "").trim();
    const parsed = JSON.parse(raw);

    const bloodGroup = VALID_GROUPS_FOR_PARSING.includes(parsed.bloodGroup) ? parsed.bloodGroup : undefined;
    const city = resolveCity(parsed.city);

    if (!bloodGroup) return null; // don't guess on the one field that truly matters
    return { bloodGroup, city };
  } catch (err) {
    console.error("AI SMS parsing failed, falling back to honest 'unclear' response:", err);
    return null;
  }
}

export function getFallbackResponse(message: string, lang: "en" | "ur", isSOS: boolean): string {
  const lowercase = message.toLowerCase();
  
  if (lang === 'ur') {
    if (isSOS) {
      return `🚨 **فوری ہنگامی امداد کا نوٹس:**\nہمیں ایسا لگتا ہے کہ آپ کو فوری خون کی ضرورت ہے۔ برائے مہربانی فوری طور پر ہمارے ویب پیج پر موجود **SOS Request Emergency** فارم کو پُر کریں یا ہماری ہیلپ لائن **1122** پر کال کریں۔\n\nراولپنڈی اور اسلام آباد میں خون کے عطیات کے لیے پمز اسلام آباد (PIMS) اور ہولی فیملی ہسپتال راولپنڈی 24 گھنٹے دستیاب ہیں۔`;
    }
    return `بلڈ ریڈار AI میں خوش آمدید۔ میں آپ کی کیا مدد کر سکتا ہوں؟ آپ ہمارے ہسپتالوں کی معلومات حاصل کر سکتے ہیں، خون کے گروپ تلاش کر سکتے ہیں، یا عطیہ دہندگان سے رابطہ کر سکتے ہیں۔`;
  }

  // English fallback
  if (isSOS) {
    return `🚨 **EMERGENCY ASSISTANCE TRIAGE ALERT:**\nIt looks like you are describing a critical situation. Please fill out our **SOS Emergency Request Form** on the sidebar instantly to broadcast alert notifications to compatible O-, A-, B+, or other available donors in Twin Cities.\n\n*Recommended Hospitals with 24/7 emergency blood banks:*\n- **PIMS Islamabad:** +92 51 9261170\n- **Holy Family Hospital Rawalpindi:** +92 51 9290321\n- **Shifa International Islamabad:** +92 51 8463000`;
  }

  if (lowercase.includes("compatibility") || lowercase.includes("compatible")) {
    return `💡 **Blood Compatibility Guide:**\n- **O-Negative** is the Universal Red Cell Donor (can donate to all groups).\n- **AB-Positive** is the Universal Recipient (can receive from all groups).\n- A- can donate to A+, A-, AB+ and AB-.\n- B- can donate to B+, B-, AB+ and AB-.\n\nWould you like me to find compatible donors registered in Rawalpindi or Islamabad right now?`;
  }

  return `Welcome to **BloodRadar**! 🩸\n\nI can assist you with Twin Cities blood donation resources:\n1. **Find compatible donors** in G-11, G-8, Sector F-10, Holy Family or Saddar.\n2. **Triage active emergencies** and broadcast notifications instantly.\n3. **Map upcoming camps** at Centaurus Mall or Giga Mall.\n\nHow can I support your healthcare requirements today?`;
}
