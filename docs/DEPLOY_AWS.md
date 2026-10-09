# Deploying JalMarg on AWS

## What runs where

| Piece | AWS service | Why | Cost |
|---|---|---|---|
| Web app (React build) | **AWS Amplify Hosting** | Builds from GitHub on every push and serves over HTTPS on a CDN | Free tier |
| API (FastAPI + SQLite) | **Amazon EC2** `t3.micro`, Ubuntu 24.04, Docker | One small server runs the API; the SQLite file sits on its EBS disk | Free tier |
| HTTPS for the API | **Caddy** container on the same EC2 | Gets a Let's Encrypt certificate automatically | Free |
| Report and work photos | **Amazon S3** (private bucket) | Photos survive server rebuilds; the API still checks who may see private originals | Free tier (5 GB) |
| AI photo check | **Amazon Bedrock**, Claude Opus 5.5 (`anthropic.claude-opus-5-5`) | Looks at each report photo and says whether flood water is visible; adds the "visual" signal | Paid per photo (new-account credits cover a demo). Set `VISION_MODEL=anthropic.claude-haiku-5-5` for a cheaper model, or `VISION_PROVIDER=none` to turn it off |
| OTP SMS | **Amazon SNS** (optional) | Sends sign-in codes by SMS | Indian numbers need a DLT-registered sender ID; until then keep `OTP_DELIVERY=console` and read codes with `docker compose logs api` |
| Logs | `docker compose logs` (CloudWatch agent optional) | | Free |

Use one region for everything: **ap-south-1 (Mumbai)**. Claude on Bedrock is reachable from Mumbai through the global endpoint.

## 1. S3 bucket
1. S3 → Create bucket → name, for example, `jalmarg-evidence-<yourname>`, region ap-south-1, keep **Block all public access** on.

## 2. IAM role for the server
1. IAM → Roles → Create role → trusted entity **EC2**.
2. Add an inline policy (replace the bucket name):
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {"Effect": "Allow", "Action": ["s3:GetObject", "s3:PutObject"], "Resource": "arn:aws:s3:::jalmarg-evidence-yourname/*"},
    {"Effect": "Allow", "Action": ["bedrock-mantle:CreateInference"], "Resource": "*"},
    {"Effect": "Allow", "Action": ["sns:Publish"], "Resource": "*"}
  ]
}
```
3. Name it `jalmarg-ec2`.
4. Bedrock console → **Model access** → request access to Anthropic Claude Opus 5.5 (and Haiku 5.5 if you plan to use it).

## 3. EC2 server
1. EC2 → Launch instance → Ubuntu 24.04, `t3.micro`, 20 GB gp3, a new key pair.
2. Security group: allow inbound 22 (your IP only), 80 and 443 (anywhere).
3. Advanced details → IAM instance profile → `jalmarg-ec2`.
4. After launch: Elastic IPs → Allocate → Associate with the instance. Note the IP, for example `13.233.10.20`.
5. Your free API domain is the IP with dashes plus `.sslip.io`, for example `13-233-10-20.sslip.io`.

SSH in (`ssh -i key.pem ubuntu@13.233.10.20`) and run:
```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu && newgrp docker
git clone https://github.com/akhawattushar/JalMarg.git && cd JalMarg
cp backend/.env.example backend/.env && nano backend/.env
```
Set these in `backend/.env`:
```
APP_ENV=production
AUTH_SECRET=<output of: openssl rand -hex 32>
ADMIN_PHONES=+91XXXXXXXXXX
CORS_ORIGINS=https://main.<amplify-id>.amplifyapp.com,capacitor://localhost,https://localhost
STORAGE_PROVIDER=s3
S3_BUCKET=jalmarg-evidence-yourname
AWS_REGION=ap-south-1
VISION_PROVIDER=bedrock
VISION_MODEL=anthropic.claude-opus-5-5
OTP_DELIVERY=console
GOOGLE_MAPS_API_KEY=...        # optional, else OpenStreetMap/Open-Meteo
```
Start it:
```bash
cd deploy
DOMAIN=13-233-10-20.sslip.io docker compose up -d --build
curl https://13-233-10-20.sslip.io/health
```
Update later with `git pull && DOMAIN=... docker compose up -d --build`. Back up the database with `docker compose cp api:/data/jalmarg.db ./backup.db`.

## 4. Web app on Amplify
1. Amplify → Create new app → GitHub → `akhawattushar/JalMarg`, branch `main`. `amplify.yml` in the repo is picked up automatically.
2. Environment variables: `VITE_API_URL=https://13-233-10-20.sslip.io`.
3. Rewrites and redirects → add: source `</^[^.]+$|\.(?!(css|gif|ico|jpg|js|png|txt|svg|woff2?|ttf|map|json|webp|webmanifest)$)([^.]+$)/>`, target `/index.html`, type `200 (Rewrite)`.
4. Deploy, then put the Amplify URL into `CORS_ORIGINS` on the server and restart: `docker compose up -d`.
5. Google Maps (if used): add the Amplify URL to the browser key's HTTP-referrer restrictions.

## 5. Android app
```bash
cd frontend
echo VITE_API_URL=https://13-233-10-20.sslip.io > .env
npm run android      # builds, syncs and opens Android Studio → Build → Build APK(s)
```
