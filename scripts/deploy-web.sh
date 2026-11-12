#!/usr/bin/env bash
# Production build of the web app (no QA signer) and a prebuilt deploy to the Vercel project noren-avax.
# web/.vercel/project.json (local, gitignored) names the project; web/vercel.json holds the /api rewrite and SPA fallback.
set -euo pipefail
cd "$(dirname "$0")/../web"
pnpm build
if grep -rqE "__NOREN_QA__|QA signer" dist/assets/*.js; then echo "QA code found in the production bundle" >&2; exit 1; fi
cp vercel.json dist/vercel.json
mkdir -p dist/.vercel && cp .vercel/project.json dist/.vercel/project.json
cd dist && vercel deploy --prod --yes
