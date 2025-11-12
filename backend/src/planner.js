const DEEPSEEK_API_URL =
  process.env.DEEPSEEK_API_URL ||
  "https://api.deepseek.com/v1/chat/completions";
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";
const REQUEST_TIMEOUT_MS = Number.parseInt(
  process.env.DEEPSEEK_TIMEOUT_MS || "45000",
  10
);

const SYSTEM_PROMPT = `你是一位專業的營養師兼料理顧問。你的任務是依照使用者的健康目標與基本資料，規劃「一日」或「一週」的個人化營養餐。

請嚴格遵循以下規範：
- 使用繁體中文。
- 回覆僅能包含有效的 JSON，禁止附加 Markdown、註解或多餘文字。
- JSON 結構須符合：
{
  "timeframe": "day" | "week",
  "title": "簡短標題",
  "profileSummary": "摘要使用者需求與限制",
  "overview": {
    "calories": number,
    "macros": { "protein": number, "carbs": number, "fat": number },
    "notes": [string]
  },
  "meals": [Meal]   // 僅 timeframe = "day" 時存在
  "days": [DayPlan] // 僅 timeframe = "week" 時存在
  "tips": [string]
}

Meal 需包含：
{
  "mealType": "早餐" | "午餐" | "晚餐" | "加餐" | "點心" | "寶寶餐",
  "name": "餐點名稱",
  "kcal": number,
  "macros": { "P": number, "C": number, "F": number },
  "ingredients": [string],
  "steps": [string],
  "tags": [string],
  "tips": [string]
}

DayPlan 需包含：
{
  "label": "Day 1" 等,
  "summary": "當日重點",
  "overview": { 同 overview 結構 },
  "meals": [Meal],
  "tips": [string]
}

請將使用者提供的過敏、忌口與目標納入規劃，若為嬰幼兒餐點務必注意安全與質地。`;

export async function generateDayPlan(input) {
  return requestPlanFromDeepSeek(input, "day");
}

export async function generateWeekPlan(input) {
  return requestPlanFromDeepSeek(input, "week");
}

export function buildShoppingList(plan) {
  if (!plan || typeof plan !== "object") {
    throw httpError(400, "購物清單請傳入有效的計畫資料。");
  }
  const meals = collectMeals(plan);
  if (!meals.length) {
    throw httpError(400, "尚未找到任何餐點，請先生成食譜。");
  }
  const items = new Map();
  meals.forEach((meal) => {
    parseIngredientList(meal?.ingredients).forEach((ingredient) => {
      const key = String(ingredient).replace(/\(.*?\)/g, "").trim();
      if (!key) return;
      items.set(key, (items.get(key) || 0) + 1);
    });
  });
  return Array.from(items.entries()).map(
    ([name, count]) => `- ${name} ×${count}`
  );
}

async function requestPlanFromDeepSeek(rawInput = {}, timeframe) {
  const request = normalizeRequest(rawInput);
  ensureGoal(request, timeframe);
  const prompt = buildPrompt(request, timeframe);
  const history = Array.isArray(request.history) ? request.history : [];
  const rawResponse = await callDeepSeek(prompt, history);
  const parsed = parsePlan(rawResponse);
  return normalizePlan(parsed, timeframe, request);
}

async function callDeepSeek(prompt, history = []) {
  const apiKey = getApiKey();
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Number.isFinite(REQUEST_TIMEOUT_MS) ? REQUEST_TIMEOUT_MS : 45000
  );

  const conversation = Array.isArray(history)
    ? history
        .map((item) => {
          const role = typeof item?.role === "string" ? item.role : null;
          const content =
            typeof item?.content === "string" ? item.content : null;
          if (!role || !content) return null;
          return { role, content };
        })
        .filter(Boolean)
    : [];
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...conversation,
    { role: "user", content: prompt },
  ];

  try {
    const response = await fetch(DEEPSEEK_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        temperature: 0.6,
        messages,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      let body = "";
      try {
        body = await response.text();
      } catch (error) {
        body = "";
      }
      throw httpError(
        response.status,
        `DeepSeek API 回應錯誤（${response.status}）：${body}`
      );
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      throw httpError(502, "DeepSeek 回傳內容為空，無法產生食譜。");
    }
    return content;
  } catch (error) {
    if (error.name === "AbortError") {
      throw httpError(504, "DeepSeek 回應逾時，請稍後再試。");
    }
    if (error.status) throw error;
    throw httpError(502, `DeepSeek API 呼叫失敗：${error.message}`);
  } finally {
    clearTimeout(timeout);
  }
}

function buildPrompt(request, timeframe) {
  const payload = {
    timeframe,
    goal: request.goal,
    goalNotes: request.goalNotes || undefined,
    profile: request.profile,
    preferences: request.preferences,
    summary: request.summary || undefined,
    guidelines: buildGoalGuidance(request.goal),
  };
  return `請依據以下使用者資訊，生成符合系統要求的 ${
    timeframe === "week" ? "七天" : "單日"
  }餐飲計畫，並僅輸出 JSON：\n${JSON.stringify(payload, null, 2)}`;
}

function buildGoalGuidance(goal) {
  switch (goal) {
    case "baby":
      return "著重嬰幼兒安全，避免蜂蜜、未全熟蛋、過鹹或過硬食材，描述軟爛或泥糊質地。";
    case "loss":
      return "以熱量控制、高纖維與高蛋白為主，提供實際份量與烹調技巧以利減脂。";
    case "muscle":
      return "確保足夠蛋白質與複合碳水，安排運動前後的加餐或恢復建議。";
    case "vegan":
      return "所有餐點採植物性食材，兼顧完整蛋白與微量營養素補充。";
    case "balanced":
      return "維持營養均衡與多樣性，兼顧實際可執行的烹調方式。";
    default:
      return "提供易於實作的健康料理，兼顧熱量與營養素的平衡。";
  }
}

function parsePlan(rawText) {
  const jsonText = extractJson(rawText);
  try {
    return JSON.parse(jsonText);
  } catch (error) {
    throw httpError(502, `DeepSeek 回傳內容無法解析為 JSON：${error.message}`);
  }
}

function normalizePlan(plan, timeframe, request) {
  if (!plan || typeof plan !== "object") {
    throw httpError(502, "DeepSeek 回傳格式不正確。");
  }

  const normalized = {
    timeframe,
    type: plan.type || inferPlanType(request.goal, timeframe),
    title:
      plan.title ||
      (request.goal === "baby"
        ? timeframe === "week"
          ? "客製嬰幼兒一周餐飲計畫"
          : "客製嬰幼兒一日輔食建議"
        : timeframe === "week"
        ? "客製一周營養餐計畫"
        : "客製一日營養餐"),
    profileSummary:
      plan.profileSummary || plan.summary || buildProfileSummary(request) || "",
    overview: normalizeOverview(plan.overview || plan.meta),
    tips: normalizeTextList(plan.tips),
    insights: normalizeTextList(plan.insights),
    goal: request.goal,
    goalNotes: request.goalNotes || null,
    profile: request.profile,
    preferences: request.preferences,
    summary: request.summary || null,
    generatedAt: new Date().toISOString(),
  };

  if (!normalized.insights?.length) {
    const overviewNotes = normalizeTextList(
      plan.overview?.notes || plan.meta?.notes
    );
    if (overviewNotes.length) {
      normalized.insights = overviewNotes;
    } else {
      delete normalized.insights;
    }
  }

  if (!normalized.tips.length && request.goal === "baby") {
    normalized.tips = [
      "避免蜂蜜、過鹹與油炸食材，維持軟爛或泥糊質地。",
      "每次新增食材請遵循少量、單一、觀察 2-3 天的原則。",
    ];
  }

  if (timeframe === "week") {
    if (!Array.isArray(plan.days) || !plan.days.length) {
      throw httpError(502, "DeepSeek 回傳缺少 days 陣列。");
    }
    normalized.days = plan.days.map((day, idx) =>
      normalizeDay(day, idx, request)
    );
    normalized.meals = [];
  } else {
    if (!Array.isArray(plan.meals) || !plan.meals.length) {
      throw httpError(502, "DeepSeek 回傳缺少 meals 陣列。");
    }
    normalized.meals = plan.meals
      .map((meal) => normalizeMeal(meal, request.goal))
      .filter(Boolean);
    normalized.days = [];
  }

  return normalized;
}

function normalizeDay(day, index, request) {
  if (!day || typeof day !== "object") {
    return {
      label: `Day ${index + 1}`,
      summary: "",
      overview: null,
      meals: [],
      tips: [],
    };
  }

  const isBaby = request.goal === "baby";
  const label = day.label || day.name || `Day ${index + 1}`;
  const overview = normalizeOverview(day.overview || day.meta);
  const summary = day.summary || day.note || "";
  const tips = normalizeTextList(day.tips);
  if (!tips.length && isBaby) {
    tips.push("觀察寶寶對新食材的反應，出現不適徵兆請暫停並諮詢醫師。");
  }
  const meals = Array.isArray(day.meals)
    ? day.meals
        .map((meal) => normalizeMeal(meal, request.goal))
        .filter(Boolean)
    : [];

  return { label, summary, overview, meals, tips };
}

function normalizeMeal(meal, goal) {
  if (!meal || typeof meal !== "object") return null;

  const name = meal.name || meal.title || "未命名餐點";
  const mealType =
    meal.mealType ||
    meal.type ||
    (goal === "baby" ? "寶寶餐" : "餐點");
  const kcal = coerceNumber(
    meal.kcal ?? meal.calories ?? meal.energy ?? meal.kilocalories
  );
  const macro = normalizeMacros(
    meal.macro || meal.macros || meal.macronutrients || meal.nutrients
  );
  const ingredients = parseIngredientList(
    meal.ingredients ?? meal.ingredientList ?? meal.materials
  );
  const steps = normalizeSteps(meal.steps ?? meal.instructions ?? meal.method);
  const instructions = steps.length
    ? steps.map((step, idx) => `${idx + 1}. ${step}`).join("\n")
    : "";
  const tips = normalizeTextList(meal.tips || meal.advice || meal.tipsList);
  const notes = normalizeTextList(meal.notes || meal.note || meal.comment).join(
    "\n"
  );
  const tags = normalizeTextList(meal.tags || meal.labels || meal.focus);

  const normalized = {
    name,
    mealType,
    kcal,
    macro,
    macros: macro
      ? {
          protein: macro.P ?? null,
          carbs: macro.C ?? null,
          fat: macro.F ?? null,
        }
      : null,
    ingredients,
    steps,
    instructions,
    tips,
    notes,
    tags,
    cuisine: meal.cuisine || meal.origin || meal.style || "",
  };

  return normalized;
}

function normalizeOverview(meta) {
  if (!meta || typeof meta !== "object") return null;
  const calories = coerceNumber(
    meta.calories ?? meta.calorieTotal ?? meta.totalCalories ?? meta.kcal
  );
  const macros = normalizeMacroTotals(meta);
  const notes = normalizeTextList(meta.notes);
  const overview = {};
  if (calories != null) overview.calories = calories;
  if (macros) overview.macros = macros;
  if (notes.length) overview.notes = notes;
  return Object.keys(overview).length ? overview : null;
}

function normalizeMacros(source) {
  if (!source) return null;
  const result = {
    P: coerceNumber(
      source.P ??
        source.p ??
        source.protein ??
        source.proteins ??
        source.proteinGrams
    ),
    C: coerceNumber(
      source.C ??
        source.c ??
        source.carbs ??
        source.carbohydrates ??
        source.carbohydrateGrams
    ),
    F: coerceNumber(
      source.F ??
        source.f ??
        source.fat ??
        source.fats ??
        source.fatGrams
    ),
  };
  const hasValue = Object.values(result).some(
    (value) => value != null && value !== ""
  );
  return hasValue ? result : null;
}

function normalizeMacroTotals(source) {
  const macrosSource =
    source.macros ||
    source.macrosTotal ||
    source.macroTotals ||
    source.macro ||
    source.macronutrients ||
    source.nutrients ||
    source;
  if (!macrosSource || typeof macrosSource !== "object") return null;
  const macros = {
    protein: coerceNumber(
      macrosSource.protein ??
        macrosSource.proteins ??
        macrosSource.P ??
        macrosSource.p
    ),
    carbs: coerceNumber(
      macrosSource.carbs ??
        macrosSource.carbohydrates ??
        macrosSource.C ??
        macrosSource.c
    ),
    fat: coerceNumber(
      macrosSource.fat ??
        macrosSource.fats ??
        macrosSource.F ??
        macrosSource.f
    ),
  };
  const hasValue = Object.values(macros).some(
    (value) => value != null && value !== ""
  );
  return hasValue ? macros : null;
}

function normalizeSteps(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return uniqueList(
      value
        .map((step) => String(step).trim())
        .filter((step) => step.length)
    );
  }
  if (typeof value === "string") {
    return value
      .split(/\n+|(?:^|\n)\d+\.\s*/)
      .map((step) => step.trim())
      .filter((step) => step.length);
  }
  if (typeof value === "object") {
    if (Array.isArray(value.steps)) return normalizeSteps(value.steps);
    return normalizeSteps(Object.values(value));
  }
  return normalizeSteps([String(value)]);
}

function normalizeTextList(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return uniqueList(
      value
        .map((item) => String(item).trim())
        .filter((item) => item.length)
    );
  }
  if (typeof value === "string") {
    return value
      .split(/[\n,，;；、]/)
      .map((item) => item.trim())
      .filter((item) => item.length);
  }
  if (typeof value === "object") {
    return normalizeTextList(Object.values(value));
  }
  return normalizeTextList([String(value)]);
}

function parseIngredientList(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item).trim())
      .filter((item) => item.length);
  }
  if (typeof value === "string") {
    return value
      .split(/[\n,，;；、]/)
      .map((item) => item.trim())
      .filter((item) => item.length);
  }
  if (typeof value === "object") {
    return parseIngredientList(Object.values(value));
  }
  return [String(value).trim()].filter((item) => item.length);
}

function collectMeals(plan) {
  if (!plan || typeof plan !== "object") return [];
  if (Array.isArray(plan.meals) && plan.meals.length) return plan.meals;
  if (Array.isArray(plan.days)) {
    return plan.days.flatMap((day) =>
      Array.isArray(day.meals) ? day.meals : []
    );
  }
  return [];
}

function normalizeRequest(raw = {}) {
  const profile = raw.profile || {};
  const preferences = raw.preferences || {};
  const profileSnapshot = raw.profileSnapshot || {};
  const preferenceSnapshot = raw.preferenceSnapshot || {};

  const allergies = uniqueList([
    ...(Array.isArray(raw.allergies) ? raw.allergies : []),
    ...(Array.isArray(profile.allergies) ? profile.allergies : []),
    ...(Array.isArray(profileSnapshot.allergies)
      ? profileSnapshot.allergies
      : []),
  ]);

  const avoidFoods = uniqueList([
    ...(Array.isArray(raw.avoidFoods) ? raw.avoidFoods : []),
    ...(Array.isArray(raw.dietaryRestrictions)
      ? raw.dietaryRestrictions
      : []),
    ...(Array.isArray(profile.avoidFoods) ? profile.avoidFoods : []),
    ...(Array.isArray(profile.dietaryRestrictions)
      ? profile.dietaryRestrictions
      : []),
    ...(Array.isArray(profileSnapshot.avoidFoods)
      ? profileSnapshot.avoidFoods
      : []),
  ]);

  const mergedProfile = {
    age: coerceNumber(
      profile.age ?? raw.age ?? profileSnapshot.age ?? raw.rawAge
    ),
    heightCm: coerceNumber(
      profile.heightCm ??
        profile.height ??
        raw.height ??
        profileSnapshot.heightCm ??
        profileSnapshot.height
    ),
    weightKg: coerceNumber(
      profile.weightKg ??
        profile.weight ??
        raw.weight ??
        profileSnapshot.weightKg ??
        profileSnapshot.weight
    ),
    babyMonths: coerceNumber(
      profile.babyMonths ??
        raw.babyMonths ??
        profileSnapshot.babyMonths ??
        profile.ageInMonths ??
        profileSnapshot.ageInMonths
    ),
    allergies,
    avoidFoods,
  };

  const mergedPreferences = {
    cuisine:
      preferences.cuisine ??
      raw.cuisine ??
      profile.cuisinePreference ??
      preferenceSnapshot.cuisine ??
      profileSnapshot.cuisinePreference ??
      null,
    caloriePreference:
      preferences.caloriePreference ??
      raw.caloriePref ??
      profile.caloriePreference ??
      preferenceSnapshot.caloriePreference ??
      profileSnapshot.caloriePreference ??
      null,
    vegetarian:
      preferences.vegetarian ??
      raw.vegetarian ??
      profile.vegetarian ??
      preferenceSnapshot.vegetarian ??
      profileSnapshot.vegetarian ??
      null,
  };

  return {
    goal:
      raw.goal ??
      profile.goal ??
      profileSnapshot.goal ??
      preferenceSnapshot.goal ??
      null,
    goalNotes: coerceString(
      raw.goalNotes ??
        raw.goalDescription ??
        profile.goalNotes ??
        preferenceSnapshot.goalNotes
    ),
    profile: mergedProfile,
    preferences: mergedPreferences,
    summary:
      coerceString(
        raw.preferenceSummary ??
          raw.summary ??
          preferences.summary ??
          profile.preferenceSummary ??
          profileSnapshot.preferenceSummary
      ) || null,
    history: normalizeHistory(
      raw.history || raw.chatHistory || raw.conversationHistory
    ),
    raw,
  };
}

function ensureGoal(request, timeframe) {
  if (!request.goal) {
    throw httpError(400, "缺少目標設定，請提供 goal 欄位。");
  }
  if (request.goal === "baby") {
    const months = request.profile.babyMonths;
    if (months == null || Number.isNaN(Number(months))) {
      throw httpError(400, "嬰幼兒計畫需提供寶寶月齡（profile.babyMonths）。");
    }
    if (Number(months) < 6 && timeframe === "day") {
      throw httpError(
        400,
        "6 個月以下以奶為主，不建議建立固體輔食計畫。"
      );
    }
  }
}

function getApiKey() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw httpError(
      500,
      "尚未設定 DEEPSEEK_API_KEY，無法呼叫 DeepSeek 服務。"
    );
  }
  return apiKey;
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function extractJson(text) {
  if (typeof text !== "string" || !text.trim()) {
    throw httpError(502, "DeepSeek 回傳為空字串。");
  }
  const codeFenceMatch = text.match(/```json([\s\S]*?)```/i);
  const candidate = codeFenceMatch ? codeFenceMatch[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw httpError(502, "DeepSeek 回傳內容找不到 JSON 結構。");
  }
  return candidate.slice(start, end + 1);
}

function inferPlanType(goal, timeframe) {
  if (timeframe === "week") {
    return goal === "baby" ? "baby-week" : "adult-week";
  }
  return goal === "baby" ? "baby-day" : "adult-day";
}

function buildProfileSummary(request) {
  const parts = [];
  if (request.goal) {
    parts.push(`目標：${labelGoal(request.goal)}`);
  }
  const profile = request.profile || {};
  if (profile.age != null) parts.push(`年齡 ${profile.age} 歲`);
  if (profile.heightCm != null) parts.push(`身高 ${profile.heightCm} cm`);
  if (profile.weightKg != null) parts.push(`體重 ${profile.weightKg} kg`);
  if (profile.babyMonths != null) {
    parts.push(`寶寶 ${profile.babyMonths} 月齡`);
  }
  if (profile.allergies?.length) {
    parts.push(`過敏：${profile.allergies.join("、")}`);
  }
  if (profile.avoidFoods?.length) {
    parts.push(`忌口：${profile.avoidFoods.join("、")}`);
  }
  if (request.preferences?.cuisine) {
    parts.push(`偏好菜系：${request.preferences.cuisine}`);
  }
  if (request.preferences?.caloriePreference) {
    const calorieLabel =
      request.preferences.caloriePreference === "low"
        ? "低熱量"
        : request.preferences.caloriePreference === "high"
        ? "高熱量"
        : "中等熱量";
    parts.push(calorieLabel);
  }
  if (request.preferences?.vegetarian) {
    parts.push("素食偏好");
  }
  const summary = parts.join("；");
  if (request.goalNotes) {
    return summary
      ? `${summary}。目標補充：${request.goalNotes}`
      : `目標補充：${request.goalNotes}`;
  }
  return summary || null;
}

function labelGoal(goal) {
  return (
    {
      loss: "減脂",
      muscle: "增肌",
      balanced: "均衡營養",
      vegan: "素食",
      baby: "嬰幼兒輔食",
    }[goal] || goal
  );
}

function coerceNumber(value) {
  if (value == null || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function coerceString(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

function uniqueList(values = []) {
  const seen = new Set();
  const result = [];
  values.forEach((value) => {
    const text = String(value).trim();
    if (!text.length) return;
    if (seen.has(text)) return;
    seen.add(text);
    result.push(text);
  });
  return result;
}

function normalizeHistory(historyInput) {
  if (!Array.isArray(historyInput)) return [];
  const limit = Number.parseInt(process.env.CONTEXT_HISTORY_LIMIT || "12", 10);
  const maxHistory = Number.isFinite(limit) && limit > 0 ? limit : 12;
  const sanitized = historyInput
    .map((entry) => {
      if (entry == null) return null;
      if (typeof entry === "string") {
        const content = coerceString(entry);
        if (!content) return null;
        return { role: "user", content };
      }
      const role = coerceString(entry.role || entry.speaker);
      const normalizedRole = normalizeHistoryRole(role);
      const content = coerceString(
        entry.content || entry.text || entry.message || entry.value
      );
      if (!normalizedRole || !content) return null;
      return { role: normalizedRole, content };
    })
    .filter(Boolean);
  return sanitized.slice(-maxHistory);
}

function normalizeHistoryRole(role) {
  if (!role) return null;
  switch (role.toLowerCase()) {
    case "assistant":
    case "bot":
    case "ai":
    case "system":
      return "assistant";
    case "user":
    case "human":
    case "client":
      return "user";
    default:
      return null;
  }
}

