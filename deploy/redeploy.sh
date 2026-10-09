#!/bin/bash
# Ship the current working tree to the running instance and restart the app.
# Usage: bash deploy/redeploy.sh
set -euo pipefail
export MSYS_NO_PATHCONV=1 AWS_PAGER="" PYTHONUTF8=1
REGION=ap-south-1
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
BUCKET=collab-scout-deploy-$ACCOUNT-aps1
INSTANCE=$(aws ec2 describe-instances --region "$REGION" \
  --filters Name=tag:Project,Values=collab-scout Name=instance-state-name,Values=running \
  --query "Reservations[0].Instances[0].InstanceId" --output text)

tar -czf collab-scout.tgz src public scripts package.json package-lock.json README.md
aws s3 cp collab-scout.tgz "s3://$BUCKET/collab-scout.tgz" --region "$REGION" --only-show-errors
rm collab-scout.tgz

COMMAND=$(aws ssm send-command --region "$REGION" --instance-ids "$INSTANCE" \
  --document-name AWS-RunShellScript --query Command.CommandId --output text \
  --parameters "commands=[
    \"set -e\",
    \"aws s3 cp s3://$BUCKET/collab-scout.tgz /tmp/collab-scout.tgz --region $REGION --only-show-errors\",
    \"rm -rf /opt/collab-scout/src /opt/collab-scout/public /opt/collab-scout/scripts\",
    \"tar -xzf /tmp/collab-scout.tgz -C /opt/collab-scout\",
    \"cd /opt/collab-scout && npm ci --omit=dev --silent && chown -R app:app /opt/collab-scout\",
    \"systemctl restart collab-scout && sleep 3 && systemctl is-active collab-scout\",
    \"curl -s localhost:8787/api/health\"
  ]")
aws ssm wait command-executed --region "$REGION" --command-id "$COMMAND" --instance-id "$INSTANCE" || true
aws ssm get-command-invocation --region "$REGION" --command-id "$COMMAND" --instance-id "$INSTANCE" \
  --query "[Status,StandardOutputContent,StandardErrorContent]" --output text
