# Launchpad — Jobs at Award-Winning Startups

Discover open roles at 200+ startups featured in Forbes, TechCrunch & Bloomberg — filtered by workplace awards from Glassdoor, Fortune, Forbes & LinkedIn.

## Architecture

```
┌─────────────────┐     ┌──────────────┐     ┌─────────────┐
│  Browser (React) │────▶│  /api/jobs   │────▶│  JSearch API │
│  public/index.html│     │  (Vercel fn) │     │  (RapidAPI)  │
└─────────────────┘     └──────────────┘     └─────────────┘
                              │
                         API key lives
                         here (server-side)
```

- **Frontend**: Single HTML file with React 18 via CDN. Zero build step.
- **Backend**: One Vercel serverless function (`/api/jobs.js`) proxying JSearch.
- **Security**: API key is server-side only. Users never see it.

## Deploy to Vercel (5 minutes)

### 1. Push to GitHub
```bash
git init
git add .
git commit -m "Initial Launchpad deploy"
gh repo create launchpad --public --source=. --push
```

### 2. Deploy
```bash
npx vercel
```

### 3. Add environment variables
In the Vercel dashboard → Settings → Environment Variables:

| Key | Value | Required |
|-----|-------|----------|
| `RAPIDAPI_KEY` | Your JSearch API key | Yes |
| `ACCESS_CODE` | Any string to gate access | No |

Or via CLI:
```bash
vercel env add RAPIDAPI_KEY
vercel env add ACCESS_CODE
```

### 4. Redeploy
```bash
vercel --prod
```

That's it. Your 200 users visit the URL and see jobs — no key prompt, no setup.

## Optional: Access Code Gating

If you set `ACCESS_CODE=mySecret123` in Vercel env vars, users will need to provide this code. In `public/index.html`, update the `ACCESS_CODE` constant:

```javascript
const ACCESS_CODE = "mySecret123";
```

This adds a basic invite-code gate. For production, consider adding proper auth (Clerk, Auth0, etc.)

## Features

- **250 curated startups** from Forbes AI 50, Cloud 100, Fintech 50, TechCrunch, Bloomberg
- **5 workplace award lists** as first-class filters:
  - ★ Glassdoor Best Places to Work 2026
  - ◆ Fortune 100 Best / Great Place to Work
  - ◉ Forbes Best Startup Employers 2026
  - ● LinkedIn Top Startups 2025
  - ▸ Newsweek Greatest Startup Workplaces 2025
- **6 filter dimensions**: Awards, Work Type, Function, Sector, Media Source, Keyword
- **AI Match**: Paste a LinkedIn URL for Claude-powered job recommendations
- **Award badges** on every company card showing which lists they made
- **"Award Winners Only" toggle** for instant filtering to vetted employers
- **Server-side caching**: 5-minute cache on API responses to reduce quota usage
- **Dark mode**: Editorial design with DM Sans + DM Serif Display

## Costs

- **JSearch API (RapidAPI)**: Free tier = 500 requests/month. Pro = 10K/month (~$50).
  One full scan of 200 companies = ~200 requests. With caching, a single scan serves
  all 200 users for 5 minutes before re-fetching.
- **Vercel**: Free tier handles 200 users easily.
- **Claude API**: Only used for the optional AI Match feature. ~$0.003 per match.

## Local Development

```bash
cp .env.example .env.local
# Edit .env.local with your RAPIDAPI_KEY
npx vercel dev
```

## Project Structure

```
launchpad/
├── api/
│   └── jobs.js          # Serverless proxy (holds API key)
├── public/
│   └── index.html       # Full React app (single file, no build)
├── .env.example         # Environment variable template
├── vercel.json          # Vercel routing config
├── package.json
└── README.md
```
