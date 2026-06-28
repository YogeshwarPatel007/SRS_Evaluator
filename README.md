# SRS Evaluator — Node.js Version
### Automated SRS Generation & Ground-Truth Comparison
**MTech Advanced Software Engineering Mini Project**

---

## Setup & Run

### 1. Install Node.js
Download from https://nodejs.org (LTS version — any 64-bit)

### 2. Set Groq API Key
Get free key at https://console.groq.com

**Windows PowerShell:**
```powershell
$env:GROQ_API_KEY="your_key_here"
```

**Windows CMD:**
```cmd
set GROQ_API_KEY=your_key_here
```

### 3. Install & Start
```powershell
npm install
npm start
```

### 4. Open Browser
Go to http://localhost:3000

---

## File Structure (Minimal)

```
srs-evaluator-node/
├── src/
│   ├── server.js              # Express API + routes
│   └── services/
│       ├── generator.js       # Groq LLM section-by-section generation
│       ├── evaluator.js       # Semantic sim + ROUGE-L + coverage
│       └── scorer.js          # Weighted aggregation
├── public/
│   └── index.html             # Complete frontend (single file)
├── data/
│   └── expert_srs/
│       ├── club_portal.json
│       └── hospital_system.json
├── package.json
└── README.md
```

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | /api/health | Health check |
| GET | /api/expert-srs | List preloaded expert SRS |
| GET | /api/expert-srs/:filename | Load specific expert SRS |
| POST | /api/generate | Generate SRS from description |
| POST | /api/compare | Compare generated vs expert |
| POST | /api/pipeline | Full one-shot pipeline |

---

## No Installation Issues
- Pure JavaScript — no compiled packages
- No GCC, no Meson, no build tools needed
- Works on any Windows 64-bit or 32-bit Node.js
