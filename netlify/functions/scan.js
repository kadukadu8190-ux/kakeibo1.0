exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method Not Allowed" }),
    };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: "サーバー側に GEMINI_API_KEY が設定されていません。",
      }),
    };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    let rawImage =
      body.imageBase64 || body.image || body.base64 || body.imageData || "";
    let mimeType = body.mimeType || "image/jpeg";

    if (!rawImage) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "画像データが含まれていません。" }),
      };
    }

    if (String(rawImage).includes(",")) {
      const parts = String(rawImage).split(",");
      if (!body.mimeType && parts[0].includes(":") && parts[0].includes(";")) {
        mimeType = parts[0].split(":")[1].split(";")[0];
      }
      rawImage = parts[1];
    }

    const todayStr = body.today || new Date().toISOString().slice(0, 10);
    const pmListText = Array.isArray(body.paymentMethods)
      ? body.paymentMethods.map((p) => `- id: "${p.id}", name: "${p.name}"`).join("\n")
      : "";
    const catListText = Array.isArray(body.categories)
      ? body.categories.map((c) => `- id: "${c.id}", label: "${c.label}"`).join("\n")
      : "";

    const prompt =
      body.prompt ||
      [
        "あなたは日本の家計簿アプリのレシート・領収書・決済画面解析AIです。",
        "添付された画像を読み取り、1つのJSONオブジェクトのみを出力してください。",
        `今日の日付: ${todayStr}`,
        catListText ? `【利用可能なカテゴリ一覧】\n${catListText}` : "",
        pmListText ? `【ユーザーの登録済み支払い方法一覧】\n${pmListText}` : "",
        "出力形式:",
        '{"amount": 1280, "date": "YYYY-MM-DD", "storeName": "店名", "summary": "主な品目", "category": "food", "paymentMethodId": ""}',
      ]
        .filter(Boolean)
        .join("\n");

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
                  data: rawImage,
                },
              },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.1,
        },
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        statusCode: response.status,
        headers,
        body: JSON.stringify({
          error: data.error?.message || "Gemini API の呼び出しに失敗しました。",
        }),
      };
    }

    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    let parsed = {};
    try {
      parsed = JSON.parse(rawText);
    } catch (_) {
      const firstBrace = rawText.indexOf("{");
      const lastBrace = rawText.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        parsed = JSON.parse(rawText.slice(firstBrace, lastBrace + 1));
      }
    }

    const normalized = {
      amount: parsed.amount ?? parsed.total ?? 0,
      date: parsed.date || todayStr,
      storeName: parsed.storeName || parsed.store || "",
      summary:
        parsed.summary ||
        (Array.isArray(parsed.items)
          ? parsed.items.map((i) => i.name).filter(Boolean).slice(0, 3).join("、")
          : ""),
      category: parsed.category || "other",
      paymentMethodId: parsed.paymentMethodId || "",
    };

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(normalized),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: err.message || "サーバーエラーが発生しました。",
      }),
    };
  }
};
