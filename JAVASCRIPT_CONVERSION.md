# spilofila — JavaScript / React conversion

Maintained by **[Kunal Vishwakarma](https://github.com/kunalvish20)**.

This tree is the JavaScript/JSX conversion of the uploaded spilofila project.

## Stack
- Next.js 16 + React 19
- JavaScript + JSX (no `.ts` / `.tsx` source files)
- MongoDB + Mongoose
- Electron desktop wrapper
- Expo / React Native mobile package
- Tailwind CSS 4
- Vitest

## Run the web app
```bash
npm install
cp .env.example .env.local
# Set MONGODB_URI in .env.local
npm run dev
```
Open http://localhost:3456.

## Production
```bash
npm run build
npm start
```

## Desktop Electron
```bash
npm run electron:dev
```

## Mobile scanner
```bash
cd packages/mobile
npm install
npm run start
```

`jsconfig.json` keeps the original `@/* -> src/*` alias. Runtime behavior, API routes,
models, import/export, printer/NFC helpers, analytics, and the Electron wrapper are retained.
