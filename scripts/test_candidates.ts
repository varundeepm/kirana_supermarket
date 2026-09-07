import "dotenv/config";

async function testWorkingModel() {
  const apiKey = process.env.GEMINI_API_KEY;
  const candidates = [
    "gemini-flash-latest",
    "gemini-flash-lite-latest",
    "gemini-3.1-flash-lite",
    "gemini-3.5-flash",
    "gemini-3.7-flash",
    "gemini-3.8-flash"
  ];
  for (const c of candidates) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${c}:generateContent?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: "hi" }] }]
        })
      });
      console.log(`Model: ${c} => status: ${res.status}`);
      if (res.ok) {
        const d = await res.json();
        console.log(`Success with ${c}! Response:`, d.candidates?.[0]?.content?.parts?.[0]?.text);
        return c;
      } else {
        const txt = await res.text();
        console.log(`Error with ${c}:`, txt.slice(0, 120));
      }
    } catch (e: any) {
      console.log(`Exception ${c}:`, e.message);
    }
  }
}

testWorkingModel();
