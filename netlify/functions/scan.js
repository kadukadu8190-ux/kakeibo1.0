exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method Not Allowed" })
    };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "サーバー側に GEMINI_API_KEY が設定されていません。" })
    };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    let { imageBase64, mimeType } = body;

    if (!imageBase64) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "画像データが含まれていません。" })
      };
    }

    if (imageBase64.includes(",")) {
      const parts = imageBase64.split(",");
      if (!mimeType && parts[0].includes(":") && parts[0].includes(";")) {
        mimeType = parts[0].split(":")[1].split(";")[0];
      }
      imageBase64 = parts[1];
    }
    mimeType = mimeType || "image/jpeg";

    const prompt = `このレシート画像を解析し、以下のJSON形式のみで出力してください。
{
  "store": "店名（不明な場合は空文字）",
  "date": "YYYY-MM-DD形式の日付（不明な場合は空文字）",
  "total": 合計金額の整数（円記号やカンマなし）,
  "category": "食費・日用品・交通費・交際費・娯楽・医療費・衣服・その他 のいずれか1つ",
  "items": [
    { "name": "商品名", "price": 金額の整数 }
  ]
}`;

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: mimeType,
                  data: imageBase64
                }
              }
            ]
          }
        ],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.1
        }
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        statusCode: response.status,
        headers,
        body: JSON.stringify({
          error: data.error?.message || "Gemini API の呼び出しに失敗しました。"
        })
      };
    }

    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    const parsed = JSON.parse(rawText);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(parsed)
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message || "サーバーエラーが発生しました。" })
    };
  }
};
