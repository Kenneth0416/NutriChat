"use strict";

const API_BASE = window.NUTRICHAT_API_BASE || "http://localhost:3000/api";
const DEFAULT_LOADING_TEXT = "正在處理，請稍候…";
const HISTORY_LIMIT =
  Number.parseInt(window.NUTRICHAT_HISTORY_LIMIT || "20", 10) || 20;

const state = {
  goal: null,
  goalNotes: "",
  babyMonths: null,
  allergies: new Set(),
  cuisine: null,
  caloriePref: null,
  vegetarian: false,
  age: null,
  height: null,
  weight: null,
  manualAllergies: new Set(),
  avoidList: [],
  currentPlan: null,
  isLoading: false,
  chatHistory: [],
};

const messagesEl = document.getElementById("messages");
const inputEl = document.getElementById("input");
const profileForm = document.getElementById("profile-form");
const goalSelect = document.getElementById("input-goal");
const goalNotesInput = document.getElementById("input-goal-notes");
const ageInput = document.getElementById("input-age");
const heightInput = document.getElementById("input-height");
const weightInput = document.getElementById("input-weight");
const allergiesInput = document.getElementById("input-allergies");
const avoidInput = document.getElementById("input-avoid");
const babyMonthsInput = document.getElementById("input-baby-months");
const goalChips = Array.from(document.querySelectorAll(".chip"));
const loadingOverlay = document.getElementById("loading-overlay");
const loadingTextEl = document.getElementById("loading-text");
const composerButtons = Array.from(
  document.querySelectorAll(".composer-actions button")
);

function recordHistory(role, text) {
  const normalizedRole = role === "bot" ? "assistant" : role === "user" ? "user" : null;
  const content = typeof text === "string" ? text.trim() : "";
  if (!normalizedRole || !content) return;
  state.chatHistory.push({ role: normalizedRole, content });
  if (state.chatHistory.length > HISTORY_LIMIT) {
    state.chatHistory.splice(0, state.chatHistory.length - HISTORY_LIMIT);
  }
}

function setLoading(isLoading, message = DEFAULT_LOADING_TEXT) {
  state.isLoading = isLoading;
  if (loadingOverlay) {
    loadingOverlay.classList.toggle("visible", isLoading);
    loadingOverlay.setAttribute("aria-hidden", isLoading ? "false" : "true");
  }
  if (loadingTextEl) {
    loadingTextEl.textContent = message || DEFAULT_LOADING_TEXT;
  }
  composerButtons.forEach((btn) => {
    btn.disabled = isLoading;
    btn.setAttribute("aria-disabled", isLoading ? "true" : "false");
  });
}

function addMessage(role, text, opts = {}) {
  const bubble = document.createElement("div");
  bubble.className = `bubble ${role}`;
  bubble.innerHTML = escapeHtml(text);
  messagesEl.appendChild(bubble);
  recordHistory(role, text);
  if (opts.cards && opts.cards.length) {
    const grid = document.createElement("div");
    grid.className = "card-grid";
    opts.cards.forEach((c) => grid.appendChild(recipeCard(c)));
    messagesEl.appendChild(grid);
  }
  if (opts.meta) {
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = opts.meta;
    bubble.appendChild(meta);
  }
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function recipeCard(r) {
  const el = document.createElement("div");
  el.className = "card";

  const kcalText = r.kcal != null ? String(r.kcal) : "--";

  const tags = [];
  if (r.cuisine) tags.push(r.cuisine);
  if (Array.isArray(r.tags)) tags.push(...r.tags);

  const tagHtml = tags.length
    ? `<div class="tags">${tags
        .map((t) => `<span class="tag">${escapeHtml(String(t))}</span>`)
        .join("")}</div>`
    : "";

  const ingredientsHtml =
    Array.isArray(r.ingredients) && r.ingredients.length
      ? `<div class="ingredients"><strong>食材：</strong><ul>${r.ingredients
          .map((item) => `<li>${escapeHtml(String(item))}</li>`)
          .join("")}</ul></div>`
      : "";

  const instructionsHtml =
    Array.isArray(r.steps) && r.steps.length
      ? `<div class="instructions"><strong>步驟：</strong><ol>${r.steps
          .map((step) => `<li>${escapeHtml(String(step))}</li>`)
          .join("")}</ol></div>`
      : r.instructions
      ? `<div class="instructions"><strong>做法：</strong>${formatTextBlock(
          r.instructions
        )}</div>`
      : "";

  const descHtml = r.desc ? `<div class="desc">${formatTextBlock(r.desc)}</div>` : "";
  const tipsHtml =
    Array.isArray(r.tips) && r.tips.length
      ? `<div class="tips"><strong>小提醒：</strong><ul>${r.tips
          .map((tip) => `<li>${escapeHtml(String(tip))}</li>`)
          .join("")}</ul></div>`
      : "";
  const notesHtml = r.notes
    ? `<div class="notes"><strong>備註：</strong>${formatTextBlock(r.notes)}</div>`
    : "";

  const parts = [
    `<h4>${escapeHtml(r.name)} <span class="kcal">· ${escapeHtml(
      kcalText
    )} kcal</span></h4>`,
  ];

  const macroHtml = buildMacroLine(r.macro);
  if (macroHtml) parts.push(macroHtml);
  if (tagHtml) parts.push(tagHtml);
  if (ingredientsHtml) parts.push(ingredientsHtml);
  if (instructionsHtml) parts.push(instructionsHtml);
  if (descHtml) parts.push(descHtml);
  if (tipsHtml) parts.push(tipsHtml);
  if (notesHtml) parts.push(notesHtml);

  el.innerHTML = parts.join("");
  return el;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (s) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[s]);
}

function formatTextBlock(text) {
  if (text == null) return "";
  return escapeHtml(String(text)).replace(/\n/g, "<br>");
}

function buildMacroLine(macro) {
  if (!macro) return "";
  const entries = [];
  if (macro.P != null && macro.P !== "") entries.push(`P ${macro.P}g`);
  if (macro.C != null && macro.C !== "") entries.push(`C ${macro.C}g`);
  if (macro.F != null && macro.F !== "") entries.push(`F ${macro.F}g`);
  if (!entries.length) return "";
  return `<div class="macro">${entries
    .map((entry) => escapeHtml(String(entry)))
    .join(" · ")}</div>`;
}

function getAllAllergies() {
  return new Set([...state.allergies, ...state.manualAllergies]);
}

function parseOptionalNumber(value, { float = false } = {}) {
  const text = String(value || "").trim();
  if (!text) return null;
  const num = float ? Number.parseFloat(text) : Number.parseInt(text, 10);
  return Number.isFinite(num) ? num : null;
}

function parseListText(value) {
  if (!value) return [];
  return value
    .split(/[\n,，;；、]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function normalizeTextList(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item).trim())
      .filter((item) => item.length);
  }
  if (typeof value === "string") {
    return parseListText(value);
  }
  if (value == null) return [];
  return [String(value).trim()].filter((item) => item.length);
}

function syncGoalUI(goal) {
  goalChips.forEach((chip) => {
    chip.classList.toggle("active", chip.dataset.goal === goal);
  });
  if (goalSelect) {
    goalSelect.value = goal || "";
  }
}

function syncProfileInputs() {
  if (goalNotesInput) goalNotesInput.value = state.goalNotes ?? "";
  if (ageInput) ageInput.value = state.age ?? "";
  if (heightInput) heightInput.value = state.height ?? "";
  if (weightInput) weightInput.value = state.weight ?? "";
  if (babyMonthsInput) babyMonthsInput.value = state.babyMonths ?? "";
  if (allergiesInput)
    allergiesInput.value = Array.from(getAllAllergies()).join(", ");
  if (avoidInput) avoidInput.value = state.avoidList.join(", ");
}

function announceGoal(goal) {
  if (!goal) return;
  if (goal === "baby") {
    addMessage(
      "bot",
      "已選擇嬰幼兒輔食。請告訴我寶寶的月齡（例如：9 個月）。"
    );
  } else {
    addMessage(
      "bot",
      `已選擇 ${labelGoal(goal)}。可以說明你的過敏或偏好菜系（中式/西式/日式/地中海）。`
    );
  }
}

function init() {
  addMessage(
    "bot",
    "你好，我是 NutriChat。告訴我你的目標（如減脂、增肌、嬰幼兒輔食），以及偏好或過敏，我會協助生成食譜。"
  );
  syncGoalUI(state.goal);
  syncProfileInputs();
  showPrefs();
}

function collectPreferenceBadges() {
  const items = [];
  if (state.goal) items.push(labelGoal(state.goal));
  if (state.babyMonths != null) items.push(`寶寶：${state.babyMonths} 月齡`);
  if (state.age != null) items.push(`年齡：${state.age} 歲`);
  if (state.height != null) items.push(`身高：${state.height} cm`);
  if (state.weight != null) items.push(`體重：${state.weight} kg`);
  if (state.cuisine) items.push(`偏好：${state.cuisine}`);
  if (state.caloriePref) {
    items.push(
      `熱量：${
        state.caloriePref === "low"
          ? "低"
          : state.caloriePref === "high"
          ? "高"
          : "中"
      }`
    );
  }
  const allAllergies = getAllAllergies();
  if (allAllergies.size) {
    items.push("過敏：" + [...allAllergies].join("、"));
  }
  if (state.avoidList.length) {
    items.push("忌口：" + state.avoidList.join("、"));
  }
  if (state.vegetarian) items.push("素食偏好");
  if (state.goalNotes) {
    const trimmed = state.goalNotes.trim();
    if (trimmed) {
      const preview = trimmed.length > 24 ? `${trimmed.slice(0, 24)}…` : trimmed;
      items.push(`目標補充：${preview}`);
    }
  }
  return items;
}

function showPrefs() {
  const prefs = document.getElementById("prefs");
  prefs.innerHTML = "";
  collectPreferenceBadges().forEach((t) => {
    const el = document.createElement("span");
    el.className = "pref";
    el.textContent = t;
    prefs.appendChild(el);
  });
}

function labelGoal(goal) {
  return (
    {
      loss: "減脂",
      muscle: "增肌",
      balanced: "均衡",
      vegan: "素食",
      baby: "嬰幼兒輔食",
    }[goal] || goal
  );
}

goalChips.forEach((chip) => {
  chip.addEventListener("click", () => {
    const goal = chip.dataset.goal || null;
    const changed = state.goal !== goal;
    state.goal = goal;
    state.vegetarian = goal === "vegan";
    syncGoalUI(goal);
    if (changed && goal) {
      announceGoal(goal);
    }
    showPrefs();
  });
});

if (goalSelect) {
  goalSelect.addEventListener("change", () => {
    const value = goalSelect.value || null;
    const changed = state.goal !== value;
    state.goal = value;
    state.vegetarian = value === "vegan";
    syncGoalUI(value);
    if (changed && value) {
      announceGoal(value);
    }
    showPrefs();
  });
}

if (goalNotesInput) {
  goalNotesInput.addEventListener("input", () => {
    const text = goalNotesInput.value || "";
    state.goalNotes = text.trim();
    showPrefs();
  });
}

if (profileForm) {
  profileForm.addEventListener("submit", (event) => {
    event.preventDefault();
  });
}

if (ageInput) {
  ageInput.addEventListener("input", () => {
    state.age = parseOptionalNumber(ageInput.value);
    showPrefs();
  });
}

if (heightInput) {
  heightInput.addEventListener("input", () => {
    state.height = parseOptionalNumber(heightInput.value, { float: true });
    showPrefs();
  });
}

if (weightInput) {
  weightInput.addEventListener("input", () => {
    state.weight = parseOptionalNumber(weightInput.value, { float: true });
    showPrefs();
  });
}

if (babyMonthsInput) {
  babyMonthsInput.addEventListener("input", () => {
    state.babyMonths = parseOptionalNumber(babyMonthsInput.value);
    showPrefs();
  });
}

if (allergiesInput) {
  allergiesInput.addEventListener("input", () => {
    state.manualAllergies = new Set(parseListText(allergiesInput.value));
    showPrefs();
  });
}

if (avoidInput) {
  avoidInput.addEventListener("input", () => {
    state.avoidList = parseListText(avoidInput.value);
    showPrefs();
  });
}

const sendBtn = document.getElementById("send");
sendBtn.addEventListener("click", handleSend);
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    handleSend();
  }
});

async function handleSend() {
  const text = inputEl.value.trim();
  if (!text) return;
  inputEl.value = "";
  addMessage("user", text);
  parseMessage(text);
}

const genDay = document.getElementById("gen-day");
const genWeek = document.getElementById("gen-week");
const genList = document.getElementById("gen-list");

genDay.addEventListener("click", () => {
  requestDayPlan();
});

genWeek.addEventListener("click", () => {
  requestWeekPlan();
});

genList.addEventListener("click", () => {
  requestShoppingList();
});

function parseMessage(t) {
  const s = t.toLowerCase();
  if (/減脂|低卡|瘦|控糖/.test(t)) state.goal = "loss";
  if (/增肌|高蛋白|力量/.test(t)) state.goal = "muscle";
  if (/均衡|健康餐|平衡/.test(t)) state.goal = "balanced";
  if (/素食|植物基|全素/.test(t)) {
    state.goal = "vegan";
    state.vegetarian = true;
  }
  if (/嬰|寶寶|輔食|幼兒/.test(t)) state.goal = "baby";

  const m = t.match(/(\d{1,2})\s*月/);
  if (m && state.goal === "baby") {
    state.babyMonths = parseInt(m[1], 10);
  }

  const ageMatch = t.match(/(\d{1,3})\s*(?:歲|岁)/);
  if (ageMatch) {
    state.age = Number.parseInt(ageMatch[1], 10);
  }

  const heightMatch = t.match(/(\d{2,3})\s*(?:cm|公分)/i);
  if (heightMatch) {
    state.height = Number.parseFloat(heightMatch[1]);
  }

  const weightMatch = t.match(/(\d{2,3}(?:\.\d+)?)\s*(?:kg|公斤)/i);
  if (weightMatch) {
    state.weight = Number.parseFloat(weightMatch[1]);
  }

  [
    ["乳制品", ["乳", "奶"]],
    ["堅果", ["堅果"]],
    ["蛋", ["蛋"]],
    ["麩質", ["麩質", "麵筋", "麵粉"]],
    ["大豆", ["大豆", "黃豆", "豆制品"]],
    ["海鮮", ["海鮮", "蝦", "蟹", "魚"]],
  ].forEach(([label, keywords]) => {
    if (
      keywords.some((k) => s.includes(k)) &&
      /過敏|不吃|不能|忌/.test(s)
    ) {
      state.allergies.add(label);
    }
  });

  if (/中餐|中式/.test(t)) state.cuisine = "中式";
  if (/西餐|西式|歐美/.test(t)) state.cuisine = "西式";
  if (/日料|日式/.test(t)) state.cuisine = "日式";
  if (/地中海/.test(t)) state.cuisine = "地中海";

  if (/低卡|低熱量|清淡/.test(t)) state.caloriePref = "low";
  if (/高熱量|高能量|增重/.test(t)) state.caloriePref = "high";

  syncGoalUI(state.goal);
  state.vegetarian = state.goal === "vegan";
  syncProfileInputs();
  showPrefs();

  if (state.goal === "baby") {
    if (state.babyMonths == null) {
      addMessage("bot", "請提供寶寶月齡（例如：8 個月、12 個月）。");
      return;
    }
    if (state.babyMonths < 6) {
      addMessage(
        "bot",
        "6 個月以下以母乳或配方奶為主，不建議添加固體輔食。請諮詢小兒科醫師以獲得個人化建議。"
      );
      return;
    }
    addMessage(
      "bot",
      "好的，我會根據月齡與過敏情況生成溫和安全的輔食搭配。可以點擊「生成一日食譜」。"
    );
  } else if (state.goal) {
    addMessage(
      "bot",
      "收到。我會避開你的過敏食材，並結合目標與偏好提供建議。可以點擊下方按鈕生成食譜。"
    );
  } else {
    addMessage(
      "bot",
      "我未偵測到你的目標。你可以選擇上方「減脂/增肌/嬰幼兒」等快捷按鈕。"
    );
  }
}

function serializeState() {
  const allergies = Array.from(getAllAllergies());
  const summaryItems = collectPreferenceBadges();
  const trimmedGoalNotes = state.goalNotes ? state.goalNotes.trim() : "";
  const profile = {
    age: state.age,
    heightCm: state.height,
    weightKg: state.weight,
    babyMonths: state.babyMonths,
    allergies,
    avoidFoods: state.avoidList,
  };
  const preferences = {
    cuisine: state.cuisine,
    caloriePreference: state.caloriePref,
    vegetarian: state.vegetarian,
  };
  return {
    goal: state.goal,
    goalNotes: trimmedGoalNotes || null,
    profile: {
      ...profile,
      cuisinePreference: state.cuisine,
      caloriePreference: state.caloriePref,
      vegetarian: state.vegetarian,
      notes:
        trimmedGoalNotes ||
        (state.avoidList.length ? state.avoidList.join(", ") : null),
    },
    preferences,
    allergies,
    avoidFoods: state.avoidList,
    cuisine: state.cuisine,
    caloriePref: state.caloriePref,
    vegetarian: state.vegetarian,
    dietaryRestrictions: state.avoidList,
    preferenceSummary: summaryItems.join("；"),
    profileSnapshot: profile,
    preferenceSnapshot: preferences,
    history: state.chatHistory
      .slice(-HISTORY_LIMIT)
      .map((entry) => ({
        role: entry.role,
        content: typeof entry.content === "string" ? entry.content.trim() : "",
      }))
      .filter((entry) => entry.content.length),
  };
}

async function requestDayPlan() {
  if (!state.goal) {
    addMessage("bot", "請先選擇目標（減脂/增肌/嬰幼兒/素食/均衡）。");
    return;
  }
  if (state.goal === "baby" && (!state.babyMonths || state.babyMonths < 6)) {
    addMessage(
      "bot",
      "請提供滿 6 個月以上的寶寶月齡，或遵循醫師建議。"
    );
    return;
  }
  if (state.isLoading) {
    return;
  }
  setLoading(true, "正在生成一日食譜，請稍候…");
  try {
    const res = await fetch(`${API_BASE}/generate/day`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(serializeState()),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || "服務返回錯誤");
    }
    const plan = await res.json();
    renderDayPlan(plan);
    state.currentPlan = plan;
  } catch (err) {
    console.error(err);
    addMessage("bot", "生成食譜時發生錯誤，請稍後再試。");
  } finally {
    setLoading(false);
  }
}

async function requestWeekPlan() {
  if (!state.goal) {
    addMessage("bot", "請先選擇目標，之後再生成一周食譜。");
    return;
  }
  if (state.isLoading) {
    return;
  }
  setLoading(true, "正在生成一周食譜，請稍候…");
  try {
    const res = await fetch(`${API_BASE}/generate/week`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(serializeState()),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || "服務返回錯誤");
    }
    const plan = await res.json();
    renderWeekPlan(plan);
    state.currentPlan = plan;
  } catch (err) {
    console.error(err);
    addMessage("bot", "生成一周食譜時發生錯誤，請稍後再試。");
  } finally {
    setLoading(false);
  }
}

async function requestShoppingList() {
  if (!state.currentPlan) {
    addMessage("bot", "請先生成一日或一周食譜，再建立購物清單。");
    return;
  }
  if (state.isLoading) {
    return;
  }
  setLoading(true, "正在建立購物清單，請稍候…");
  try {
    const res = await fetch(`${API_BASE}/shopping-list`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan: state.currentPlan }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || "服務返回錯誤");
    }
    const data = await res.json();
    renderShoppingList(data.list);
    if (Array.isArray(data.list)) {
      downloadText("購物清單.txt", data.list.join("\n"));
    }
  } catch (err) {
    console.error(err);
    addMessage("bot", "建立購物清單時發生錯誤，請稍後再試。");
  } finally {
    setLoading(false);
  }
}

function formatMealCard(meal, planType) {
  if (!meal) return null;
  const baseName = meal.name || meal.title || "未命名餐點";
  const displayName = meal.mealType
    ? `${meal.mealType}｜${baseName}`
    : baseName;
  const macro = normalizeMacros(
    meal.macro || meal.macros || meal.macronutrients || meal.nutrients
  );
  const calories =
    meal.kcal ??
    meal.calories ??
    meal.energy ??
    meal.kilocalories ??
    (meal.meta ? meal.meta.calories : null);
  const tags = new Set();
  if (meal.mealType) tags.add(meal.mealType);
  if (Array.isArray(meal.tags)) meal.tags.forEach((tag) => tags.add(tag));
  if (meal.focus) tags.add(meal.focus);
  if (meal.goal) tags.add(meal.goal);
  if (planType && String(planType).includes("baby")) tags.add("寶寶");

  const descParts = [];
  if (meal.summary) descParts.push(meal.summary);
  if (meal.description) descParts.push(meal.description);
  if (meal.rationale) descParts.push(meal.rationale);

  const tips = Array.isArray(meal.tips)
    ? meal.tips.map((tip) => String(tip).trim()).filter(Boolean)
    : meal.tips
    ? [String(meal.tips).trim()].filter(Boolean)
    : [];

  const ingredients = parseIngredientList(
    meal.ingredients ?? meal.ingredientList
  );
  const steps = normalizeSteps(meal.steps ?? meal.instructions);
  const instructions = steps.length
    ? steps.map((step, idx) => `${idx + 1}. ${step}`).join("\n")
    : "";
  const noteParts = [];
  if (Array.isArray(meal.notes)) {
    noteParts.push(
      ...meal.notes
        .map((note) => String(note).trim())
        .filter((note) => note.length)
    );
  } else if (meal.notes) {
    noteParts.push(String(meal.notes).trim());
  }
  if (meal.remark) noteParts.push(String(meal.remark).trim());
  if (!instructions && (meal.instructions || meal.steps)) {
    const fallback = instructionsToText(meal.instructions ?? meal.steps);
    if (fallback && !instructions) {
      noteParts.push(fallback);
    }
  }
  const notes = noteParts.join("\n");

  return {
    name: displayName,
    kcal: calories != null ? calories : "--",
    macro,
    tags: Array.from(tags).filter(Boolean),
    cuisine: meal.cuisine || meal.origin || "",
    ingredients,
    instructions,
    steps,
    tips,
    desc: descParts.join("\n"),
    notes,
  };
}

function normalizeMacros(source) {
  if (!source) return null;
  const result = {
    P:
      source.P ??
      source.p ??
      source.protein ??
      source.proteins ??
      source.proteinGrams,
    C:
      source.C ??
      source.c ??
      source.carbs ??
      source.carbohydrates ??
      source.carbohydrateGrams,
    F:
      source.F ??
      source.f ??
      source.fat ??
      source.fats ??
      source.fatGrams,
  };
  const hasValue = Object.values(result).some(
    (value) => value != null && value !== ""
  );
  return hasValue ? result : null;
}

function parseIngredientList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (typeof value === "string") {
    return value
      .split(/[\n,，;；、]/)
      .map((item) => item.trim())
      .filter((item) => item.length);
  }
  return [];
}

function instructionsToText(value) {
  const steps = normalizeSteps(value);
  if (!steps.length) return "";
  return steps.map((step, idx) => `${idx + 1}. ${step}`).join("\n");
}

function normalizeSteps(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((step) => String(step).trim())
      .filter((step) => step.length);
  }
  if (typeof value === "string") {
    return value
      .split(/\n+/)
      .map((step) => step.trim())
      .filter((step) => step.length);
  }
  if (typeof value === "object") {
    if (Array.isArray(value.steps)) return normalizeSteps(value.steps);
    return Object.values(value)
      .map((step) => String(step).trim())
      .filter((step) => step.length);
  }
  return [String(value).trim()].filter((step) => step.length);
}

function buildMetaSummary(meta) {
  if (!meta) return null;
  const parts = [];
  const calories =
    meta.calorieTotal ?? meta.calories ?? meta.energy ?? meta.kcal;
  if (calories) parts.push(`熱量約 ${calories} kcal`);
  const macros = meta.macrosTotal || meta.macros;
  if (macros) {
    const macroParts = [];
    if (macros.protein != null)
      macroParts.push(`蛋白 ${macros.protein} g`);
    if (macros.carbs != null) macroParts.push(`碳水 ${macros.carbs} g`);
    if (macros.fat != null) macroParts.push(`脂肪 ${macros.fat} g`);
    if (macroParts.length) parts.push(macroParts.join(" · "));
  }
  if (meta.calorieRange) parts.push(`熱量區間 ${meta.calorieRange}`);
  if (Array.isArray(meta.notes)) {
    parts.push(...meta.notes);
  } else if (meta.notes) {
    parts.push(meta.notes);
  }
  return parts.length ? parts.join(" · ") : null;
}

function formatTips(tips) {
  const list = normalizeTextList(tips);
  if (!list.length) return "";
  return list.map((tip) => `- ${tip}`).join("\n");
}

function renderDayPlan(plan) {
  const timeframe = plan?.timeframe || (plan?.type?.includes("week") ? "week" : "day");
  const isBabyPlan =
    (plan?.type && plan.type.includes("baby")) ||
    plan?.profile?.isBaby ||
    plan?.goal === "baby" ||
    plan?.profile?.goal === "baby";
  const planType = plan?.type || (isBabyPlan ? "baby-day" : "adult-day");
  const cards = Array.isArray(plan?.meals)
    ? plan.meals
        .map((meal) => formatMealCard(meal, planType))
        .filter(Boolean)
    : [];
  const heading =
    plan.title ||
    (planType === "baby-day"
      ? "客製嬰幼兒一日輔食建議："
      : "客製一日營養餐：");
  const meta = buildMetaSummary(plan.overview || plan.meta);
  const options = {};
  if (cards.length) options.cards = cards;
  if (meta) options.meta = meta;
  addMessage("bot", heading, options);

  const profileSummary =
    plan.profileSummary ||
    plan.profile?.summary ||
    plan.summary?.profile ||
    "";
  if (profileSummary) {
    addMessage("bot", profileSummary);
  }

  const insightsList = normalizeTextList(
    plan.insights || plan.summary?.insights || plan.overview?.notes
  );
  if (insightsList.length) {
    addMessage("bot", insightsList.join("\n"));
  }

  const tipsText = formatTips(plan.tips);
  if (tipsText) {
    addMessage("bot", `提示：\n${tipsText}`);
  } else if (planType === "baby-day") {
    addMessage(
      "bot",
      `提示：
- 不加鹽糖蜂蜜，優先蒸煮與打泥/軟顆粒；
- 首次添加新食材遵循「少量、單一、觀察」原則；
- 如有過敏或特殊情況，請諮詢小兒科醫師。`
    );
  }
}

function renderWeekPlan(plan) {
  const isBabyPlan =
    (plan?.type && plan.type.includes("baby")) ||
    plan?.profile?.isBaby ||
    plan?.goal === "baby" ||
    plan?.profile?.goal === "baby";
  const planType = plan?.type || (isBabyPlan ? "baby-week" : "adult-week");
  const heading =
    plan.title ||
    (planType === "baby-week"
      ? "客製嬰幼兒一周輔食參考："
      : "客製一周營養餐參考：");
  const headerOpts = {};
  const meta = buildMetaSummary(plan.overview || plan.meta);
  if (meta) headerOpts.meta = meta;
  addMessage("bot", heading, headerOpts);

  const profileSummary =
    plan.profileSummary ||
    plan.profile?.summary ||
    plan.summary?.profile ||
    "";
  if (profileSummary) {
    addMessage("bot", profileSummary);
  }

  const insightsList = normalizeTextList(
    plan.insights || plan.summary?.insights || plan.overview?.notes
  );
  if (insightsList.length) {
    addMessage("bot", insightsList.join("\n"));
  }

  const days = Array.isArray(plan?.days) ? plan.days : [];
  days.forEach((day, idx) => {
    const cards = Array.isArray(day?.meals)
      ? day.meals
          .map((meal) => formatMealCard(meal, planType))
          .filter(Boolean)
      : [];
    const label = day?.label || day?.name || `Day ${idx + 1}`;
    const dayOpts = {};
    if (cards.length) dayOpts.cards = cards;
    const dayMeta = buildMetaSummary(day?.overview || day?.meta);
    if (dayMeta) dayOpts.meta = dayMeta;
    addMessage("bot", label, dayOpts);
    if (day?.summary) {
      addMessage("bot", day.summary);
    }
    const dayTips = formatTips(day?.tips);
    if (dayTips) {
      addMessage("bot", `補充：\n${dayTips}`);
    }
  });

  const tipsText = formatTips(plan?.tips);
  if (tipsText) {
    addMessage("bot", `提示：\n${tipsText}`);
  }
}

function renderShoppingList(list) {
  addMessage("bot", "已根據目前計畫生成購物清單：\n" + list.join("\n"));
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

init();

