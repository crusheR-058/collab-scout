#!/bin/bash
# First-boot setup for the Collab Scout EC2 instance (Amazon Linux 2023).
# Secrets are not in this file: the Qloo key is read from SSM Parameter Store
# and the instance role gives access to Bedrock.
set -euxo pipefail

REGION=ap-south-1
NODE_VERSION=v24.16.0
HARNESS_VERSION=0.1.26
APP_DIR=/opt/collab-scout
BUNDLE=s3://__BUCKET__/collab-scout.tgz

dnf install -y tar xz gzip
curl -fsSL "https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-linux-x64.tar.xz" |
  tar -xJ -C /usr/local --strip-components=1
npm install --global "@qloo/qloo-harness@${HARNESS_VERSION}"

id app >/dev/null 2>&1 || useradd --system --create-home --home-dir /home/app app
mkdir -p "$APP_DIR"
aws s3 cp "$BUNDLE" /tmp/collab-scout.tgz --region "$REGION"
tar -xzf /tmp/collab-scout.tgz -C "$APP_DIR"
cd "$APP_DIR"
npm ci --omit=dev
chown -R app:app "$APP_DIR"

QLOO_KEY=$(aws ssm get-parameter --region "$REGION" --name /collab-scout/qloo-api-key \
  --with-decryption --query Parameter.Value --output text)
set +x
cat >/etc/collab-scout.env <<EOF
QLOO_API_KEY=${QLOO_KEY}
QLOO_BASE_URL=https://hackathon.api.qloo.com
QLOO_TRUSTED_BASE_URL=https://hackathon.api.qloo.com
AWS_REGION=${REGION}
BEDROCK_MODEL_ID=zai.glm-4.7
PORT=8787
SCOUTS_PER_HOUR=8
EOF
set -x
chmod 600 /etc/collab-scout.env

cat >/etc/systemd/system/collab-scout.service <<EOF
[Unit]
Description=Collab Scout
After=network-online.target
Wants=network-online.target

[Service]
User=app
WorkingDirectory=${APP_DIR}
EnvironmentFile=/etc/collab-scout.env
Environment=PATH=/usr/local/bin:/usr/bin:/bin
ExecStart=/usr/local/bin/node src/server.mjs
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now collab-scout
