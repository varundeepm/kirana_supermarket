import "dotenv/config";

async function listModels() {
  const apiKey = process.env.GEMINI_API_KEY;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
  const data = await res.json();
  console.log("Models:", JSON.stringify(data.models?.map((m: any) => m.name), null, 2));
}

listModels();
