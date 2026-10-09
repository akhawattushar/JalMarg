# JalMarg

Monsoon waterlogging intelligence for cities. Citizens report flooded roads with a **live photo + precise GPS**, nearby people confirm with **I SEE IT TOO**, commuters get **lower-risk routes**, and ward officers turn verified incidents into **work orders** that close the loop back to every reporter.

> JalMarg answers: *who observed what, where, when — and whether someone else already observed the same real-world problem.*

Web app (responsive PWA) and Android app (Capacitor) from one React codebase, backed by a FastAPI service. Everything runs on free tiers.

## Core ideas

| | |
|---|---|
| **Report ≠ incident** | A report is one person’s observation; an incident is the real-world event. Many reports and confirmations strengthen one incident. |
| **Road-aware matching** | Reports are snapped to a road segment (Google Roads / OpenStreetMap). Same segment within 150 m → merged. Same road, or any unidentified road, within 500 m → the citizen is asked. Different road → separate, even if it’s close. All thresholds are configurable. |
| **Live evidence** | Camera only, no gallery. The exact location and its accuracy are captured at the shutter; approximate fixes (worse than ±50 m) are accepted but marked *Needs review*. The server burns road, area, GPS, time, accuracy and report ID into the image pixels, keeps the original privately, and stores SHA-256 hashes of both. The watermark is context, not proof. |
| **Explainable verification** | States are *Verified, Likely, Needs review, Suspicious, Rejected*. They come from independent signals (live capture, GPS, road match, server vs. capture time, reused photo, weather, community confirmations). No fabricated confidence percentages. |
| **Explainable risk** | A rule-based LOW → SEVERE estimate from forecast and recent rainfall, active and confirmed incidents, and 30-day history. Every factor is listed. If weather is unavailable, the app says so. |
| **Closing the loop** | Officer assigns a field worker → the worker marks *on the way* and *started* (citizens see both live) → the worker marks *done* with a compulsory live photo, GPS and time → the ward officer verifies the photo and approves (incident resolved, citizens notified) or sends it back. Citizens who reported or confirmed it can then rate the worker and write a review, or raise an issue with a live photo; the officer reopens the incident or closes the issue. |

## Providers (all free-tier)

| Service | Primary | Free alternative (no key) |
|---|---|---|
| Map, places, road matching, routes | Google Maps Platform (Maps JS, Places, Geocoding, Roads, Routes) | OpenStreetMap: OpenFreeMap tiles, Nominatim, OSRM, Overpass |
| Weather | Google Weather API | Open-Meteo |
| Storage | Amazon S3 (`STORAGE_PROVIDER=s3`) | Local filesystem |
| Photo check | Claude on Amazon Bedrock (`VISION_PROVIDER=bedrock`) | Off (signal shows *not configured*) |
| OTP SMS | Amazon SNS (`OTP_DELIVERY=sns`) | API console |
| Database | SQLite on the server disk | — |

The provider is chosen by configuration (`MAP_PROVIDER`, `WEATHER_PROVIDER`). Google is the default when `GOOGLE_MAPS_API_KEY` is set. The active provider is always shown in the UI. Nothing is ever faked: when a provider fails, the app shows an *unavailable* state. Google Maps Platform includes monthly free usage, but needs a billing-enabled Cloud project. The OpenStreetMap services are free with fair-use limits.

## Run locally

Requirements: Python 3.12+, Node 22+.

```bash
# API
cd backend
python -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env            # add ADMIN_PHONES=+91XXXXXXXXXX, optional Google keys
uvicorn app.main:app --reload   # http://localhost:8000  (interactive API docs at /docs)

# Web app
cd frontend
npm install
cp .env.example .env            # VITE_API_URL=http://localhost:8000
npm run dev                     # http://localhost:5173
```

The database is created automatically at `backend/data/jalmarg.db`. It starts empty — there is no seed data.

**Sign-in.** The app opens on the sign-in page. Choose an account type there:

| Account | How they sign in | Lands on | Can do |
|---|---|---|---|
| **Citizen / Commuter** | Mobile + one-time code, or mobile + password (set one in Account after the first OTP sign-in) | Live map | Report with live evidence, I SEE IT TOO, comment, follow, safe routes, alerts |
| **Field worker** | **Employee ID** (e.g. `JM-WRK-1001`) + password | Work orders | Assigned jobs: on the way → start work → mark done with a compulsory live photo |
| **Ward officer** | **Employee ID** (e.g. `JM-OFF-1001`) + password | Ward dashboard | Priority queue, assign work, verify completion photos, handle citizen issues, add or remove field workers (Field team) |
| **Admin** | Only numbers listed in `ADMIN_PHONES`, with a one-time code | Admin | Review reports, create staff accounts, reset passwords, block accounts, audit log |

Staff accounts can't be self-registered. The admin creates officers and workers in **Admin → Staff**, and ward officers add their own field workers under **Field team**, which issues the Employee ID and a temporary password (shown once). The staff member must replace it at first sign-in. Passwords are stored as scrypt hashes, and 5 wrong attempts lock the account for 15 minutes. Staff can't use citizen OTP sign-in.

In development, one-time codes are printed in the API console (`[OTP] +91…: 123456`). In production they are sent by SMS through Cognito/SNS. Guests can view the live map without signing in.

**Camera & location:** browsers allow camera and precise location only on `https://` or `http://localhost`. To test on a phone, use the Android app or serve the web app over HTTPS.

### Google Maps Platform setup

1. In Google Cloud, enable **Maps JavaScript API, Places API (New), Geocoding API, Roads API, Routes API, Weather API**.
2. Create a server key (restricted to those APIs) → `GOOGLE_MAPS_API_KEY`. Optionally create a browser key restricted by HTTP referrer → `GOOGLE_MAPS_BROWSER_KEY`.
3. Create a vector **Map ID** (Map Management) → `GOOGLE_MAP_ID`. This is needed for advanced markers.
4. Set budget alerts. JalMarg keeps calls low: weather is cached for 10 min per area; Roads and Geocoding run once per report; Routes runs only when a route is requested; place search is debounced.

### Android app

```bash
cd frontend
echo "VITE_API_URL=https://your-api-host" > .env     # must be reachable from the phone over HTTPS
npm run android                                       # builds, syncs and opens Android Studio
```

The report screen opens the native camera with `CameraSource.Camera`, so the gallery is never offered. Camera and fine-location permissions are declared in `android/app/src/main/AndroidManifest.xml`.

## Architecture

```
frontend/  React 19 + TypeScript + Vite + Tailwind 4, Capacitor (Android)
  map/       Engine interface → google.ts (clustering, advanced markers) | libre.ts (MapLibre + OSM)
  pages/     Map · Report · Incident · Safe route · Alerts · Ward · Work orders · Admin · Account
  lib/       API client (upload progress), auth, live GPS, offline queue, camera
backend/   FastAPI + SQLite + Pillow
  providers/ maps.py (Google | OSM | Mock), weather.py (Google | Open-Meteo | Mock), storage.py (Local → S3)
  services/  matching (IncidentMatchingService), verification, evidence (watermark + hashes), risk, events
  routes_public.py, routes_staff.py
```

Business logic depends on service interfaces, not on vendors. AWS deployment steps: [docs/DEPLOY_AWS.md](docs/DEPLOY_AWS.md).

| Interface | Local | AWS |
|---|---|---|
| Web hosting | Vite dev server | Amplify Hosting |
| API | uvicorn | EC2 + Docker + Caddy (HTTPS) |
| StorageService | filesystem | S3 (private) |
| Database | SQLite | SQLite on EBS |
| VerificationService | rule-based signals | + Claude on Bedrock visual check |
| Events (`REPORT_CREATED`, `WORK_STARTED`, `INCIDENT_RESOLVED`…) | in-process bus | EventBridge / SQS |
| Notifications | in-app | in-app |
| OTP | console | SNS SMS |
| Monitoring | logs | Docker logs / CloudWatch |

## Security & privacy

- Server-side validation of every field, image MIME/size checks (8 MB), GPS accuracy limits, per-user daily report limit, OTP throttling and attempt limits.
- Role-based access: citizen, commuter, worker, ward officer, admin. Every staff and admin action is written to the audit log.
- Client timestamps, road names and watermark text are never trusted. The server records its own receive time and does its own road matching.
- Public views show the incident’s road-snapped location, never the reporter’s exact position or phone number. Original photos and raw evidence metadata are visible only to staff.
- No secrets in Git. `.env` is ignored, and `.env.example` documents every setting.

## Tests

```bash
cd backend && pytest -q && ruff check .
cd frontend && npm run typecheck && npm run build
```

The backend tests cover: live reporting and validation (gallery, poor GPS, bad image, missing fields), same-segment merging, possible duplicates on the same road, a different road nearby, different problem types, resolved incidents, the same user reporting twice, unmatched roads, reused photos and stale captures, I SEE IT TOO rules, unavailable weather, risk changes, routing around hazards, the full work-order lifecycle with notifications and reopening, admin moderation and roles, and OTP login. Tests use mock providers only; the app itself never does.

## Limitations

- Visual water detection runs only when `VISION_PROVIDER=bedrock` is set. Otherwise this signal shows as *not configured*, and verification relies on the other signals plus community confirmation.
- The risk score is a transparent rule-based estimate, not a trained flood model.
- Routes are *lower-risk based on current reports*, never guaranteed safe.
