# AI Translator Dashboard

## Render deployment

Deploy this project as a **Render Web Service**. You do not need Docker for this repo because it uses the Node runtime directly from `package.json`.

Use these Render settings:

- **Service type:** Web Service
- **Runtime:** Node
- **Build command:** `npm install`
- **Start command:** `npm start`
- **Environment variable:** `GROQ_API_KEY` = your Groq API key

Use `GROQ_API_KEY` on Render. The server also checks `GROQ-API-KEY`, `GROQ_APIKEY`, and `GROQ_KEY` for compatibility, but Render deployments are most reliable with underscore names. After adding or changing the environment variable, redeploy/restart the Render Web Service so Node receives the new value.

If the app says `Failed` or `/api/groq-chat` returns `500`, open the response body in DevTools. The server now returns which Groq environment variable names it checked so you can confirm whether Render actually passed the variable to the service.
