#!/usr/bin/env bash
# Production build of the web app and prebuilt deploys of the same build to two Vercel projects:
#   noren-avax           (landing + Noren app)            web/.vercel/project.json
#   noren-avax-merchant  (Noren Merchant + hosted checkout) web/.vercel-merchant/project.json
# Both project.json files are local and gitignored. web/vercel.json holds the /api rewrite and the SPA fallback.
set -euo pipefail
cd "$(dirname "$0")/../web"
pnpm build
if grep -rqE "__NOREN_QA__|QA signer" dist/assets/*.js; then echo "QA code found in the production bundle" >&2; exit 1; fi
cp vercel.json dist/vercel.json
for p in .vercel .vercel-merchant; do
  rm -rf dist/.vercel && mkdir -p dist/.vercel && cp "$p/project.json" dist/.vercel/project.json
  (cd dist && vercel deploy --prod --yes) | tail -2
done
rm -rf dist/.vercel
