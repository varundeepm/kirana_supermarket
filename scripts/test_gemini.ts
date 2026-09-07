import "dotenv/config";

async function test() {
  const apiKey = process.env.GEMINI_API_KEY;
  console.log("Testing with GEMINI_API_KEY present:", !!apiKey);
  const models = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash", "gemini-3.6-flash"];
  for (const m of models) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: "ping" }] }]
        })
      });
      console.log(`Model ${m} status:`, res.status);
      if (res.ok) {
        const data: any = await res.json();
        console.log(`Model ${m} replied:`, data.candidates?.[0]?.content?.parts?.[0]?.text);
        break;
      } else {
        const err = await res.text();
        console.log(`Model ${m} error:`, err.slice(0, 150));
      }
    } catch (e: any) {
      console.log(`Model ${m} fetch exception:`, e.message);
    }
  }
}

test();
