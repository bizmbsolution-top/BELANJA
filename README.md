# Belanja

Aplikasi operasional Sentralogis.

## Requirements

- Node.js 20.9 or newer
- npm

## Local development

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Production build

```bash
npm run build
npm start
```

## Deployment

The application is designed for deployment on Vercel. Configure the project root as the repository root and use the default Next.js build settings.

Supabase credentials will be added in Vercel Environment Variables when the authentication and database integration stage begins. Never put a Supabase service-role key in browser-exposed variables.
