# NutriChat 健康食譜助手

前後端分離版本的 NutriChat，提供個人化健康餐與嬰幼兒輔食建議。前端負責互動介面，後端使用 Node.js（Express）提供食譜生成與購物清單 API。

## 專案結構

- `frontend/`：靜態前端（HTML/CSS/JS）
- `backend/`：Node.js 後端服務（Express + CORS）

## 後端啟動方式

```bash
cd backend
npm install
npm run dev        # 使用 nodemon 熱重新載入
# 或
npm start          # 直接執行 Node.js
```

預設服務在 `http://localhost:3000`，主要 API 路徑為：

- `POST /api/generate/day`：生成一日食譜
- `POST /api/generate/week`：生成一周食譜
- `POST /api/shopping-list`：依據現有計畫生成購物清單

## 前端啟動方式

前端為純靜態頁面，可使用任一開發用靜態伺服器。

```bash
# 方式一：使用 npx serve
npx serve frontend

# 方式二：使用 Python 簡易伺服器
cd frontend
python3 -m http.server 4173
```

開啟瀏覽器連到伺服器網址（例如 `http://localhost:4173`），即可看到聊天介面。前端預設會呼叫 `http://localhost:3000/api`；若後端部署在其他位置，可在載入頁面前宣告：

```html
<script>
  window.NUTRICHAT_API_BASE = "https://your-domain/api";
</script>
<script src="./app.js"></script>
```

## 未來可考慮的強化項目

- 將食譜資料改由資料庫儲存並提供管理介面
- 加入使用者登入，保存個人偏好
- 擴充食譜來源與營養計算引擎
- 增加自動化測試與 CI/CD 流程

