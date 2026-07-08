# Agent Run Report - 2026-07-08 CCP AWS Origin Fix

## Scope

- Verified Amazon Connect Approved origins with AWS CLI using profile `nailnew`.
- Re-applied the exact production app origin for the expected Amazon Connect instance.
- Made production `/call-center` default to Direct CCP mode unless `VITE_AMAZON_CONNECT_EMBEDDED_CCP_ENABLED` is exactly `true`.
- Kept queue, selected salon context, call handling, customer creation, appointment creation, notes, callback, SMS fallback, and completion actions on real APIs.
- Did not change Lex, Connect contact-flow JSON, Lambda booking handler, AI booking service, DTMF, press-0 escalation, appointment creation logic, staff/service matching, or seed data.

## Root Cause

AWS verification found the expected AWS account, region, and Amazon Connect instance. The production origin `https://app-new-nail.kendemo.com` was already present and was re-applied successfully without a trailing slash.

Because the browser still reports `frame-ancestors 'self'` for `https://fastaibooking.my.connect.aws/`, the embedded iframe allowlist is not effectively applied in-browser yet, or the browser is loading a CCP URL/instance that Amazon Connect still treats as not approved. Direct CCP works independently, so production now avoids `connect.core.initCCP` by default and uses Direct CCP mode to prevent broken iframe and repeated ACK timeout spam.

## AWS CLI Raw Output File

- `docs/aws-connect-approved-origin-check-2026-07-08.txt`

## AWS Findings

- AWS Account ID found: `197452633989`
- AWS region: `us-east-1`
- Amazon Connect instance id found: `74f78377-766f-46b7-a745-4bc97b68a8dc`
- Amazon Connect instance alias found: `fastaibooking`
- Approved origins before: `http://localhost:5173`, `https://app-new-nail.kendemo.com`
- Approved origins after: `http://localhost:5173`, `https://app-new-nail.kendemo.com`
- Production origin exists: yes, `https://app-new-nail.kendemo.com`
- FORCE_REAPPLY succeeded: yes
- Note: the list contains the production origin plus localhost. The script did not remove localhost because unrelated origins must not be removed.

## AWS CLI Raw Output

```text
## Date
Wed Jul  8 13:15:37 UTC 2026

## AWS caller identity
{
    "UserId": "AIDAS36IYC6CWTXUH2L5S",
    "Account": "197452633989",
    "Arn": "arn:aws:iam::197452633989:user/fastaibooking-codex-deployer"
}

## Amazon Connect instances in us-east-1
-----------------------------------------------------------------------------------------------------------------------------------------------------------
|                                                                      ListInstances                                                                      |
+---------------------------------------------------------------------------------------------------------------------------------------------------------+
||                                                                  InstanceSummaryList                                                                  ||
|+------------------------+------------------------------------------------------------------------------------------------------------------------------+|
||  Arn                   |  arn:aws:connect:us-east-1:197452633989:instance/74f78377-766f-46b7-a745-4bc97b68a8dc                                        ||
||  CreatedTime           |  2026-04-22T06:20:52-04:00                                                                                                   ||
||  Id                    |  74f78377-766f-46b7-a745-4bc97b68a8dc                                                                                        ||
||  IdentityManagementType|  CONNECT_MANAGED                                                                                                             ||
||  InboundCallsEnabled   |  True                                                                                                                        ||
||  InstanceAccessUrl     |  https://fastaibooking.my.connect.aws                                                                                        ||
||  InstanceAlias         |  fastaibooking                                                                                                               ||
||  InstanceStatus        |  ACTIVE                                                                                                                      ||
||  OutboundCallsEnabled  |  True                                                                                                                        ||
||  ServiceRole           |  arn:aws:iam::197452633989:role/aws-service-role/connect.amazonaws.com/AWSServiceRoleForAmazonConnect_jctanKRIFoRoCKpf7v4S   ||
|+------------------------+------------------------------------------------------------------------------------------------------------------------------+|

## Matching fastaibooking instances
---------------------------------------------------------------------
|                           ListInstances                           |
+---------------------------------------+-----------------+---------+
|  74f78377-766f-46b7-a745-4bc97b68a8dc |  fastaibooking  |  ACTIVE |
+---------------------------------------+-----------------+---------+

## Approved origins for expected instance
{
    "Origins": [
        "http://localhost:5173",
        "https://app-new-nail.kendemo.com"
    ]
}

## Re-apply exact production origin
Using AWS profile nailnew in region us-east-1
AWS caller identity:
  Account: 197452633989
  ARN: arn:aws:iam::197452633989:user/fastaibooking-codex-deployer
  UserId: AIDAS36IYC6CWTXUH2L5S
Finding Amazon Connect instance matching "fastaibooking"...
Using Amazon Connect instance:
  Alias: fastaibooking
  Id: 74f78377-766f-46b7-a745-4bc97b68a8dc
  Region: us-east-1
Checking current Approved origins...
Approved origins before update:
  - http://localhost:5173
  - https://app-new-nail.kendemo.com
FORCE_REAPPLY=true: disassociating exact APP_ORIGIN only: https://app-new-nail.kendemo.com
Associating Approved origin: https://app-new-nail.kendemo.com
Already approved: http://localhost:5173
Approved origins after update:
  - http://localhost:5173
  - https://app-new-nail.kendemo.com
Approved origins table:
--------------------------------------
|         ListApprovedOrigins        |
+------------------------------------+
|  http://localhost:5173             |
|  https://app-new-nail.kendemo.com  |
+------------------------------------+
Command summary:
  AWS_PROFILE=nailnew
  AWS_REGION=us-east-1
  AWS_ACCOUNT_ID=197452633989
  INSTANCE_ALIAS=fastaibooking
  INSTANCE_ID=74f78377-766f-46b7-a745-4bc97b68a8dc
  APP_ORIGIN=https://app-new-nail.kendemo.com
  FORCE_REAPPLY=true

## Approved origins after re-apply
{
    "Origins": [
        "http://localhost:5173",
        "https://app-new-nail.kendemo.com"
    ]
}
```

## Frontend Files Changed

- `apps/app/src/pages/call-center-page.tsx`
- `apps/app/src/lib/i18n.tsx`
- `apps/app/src/styles.css`
- `apps/app/Dockerfile`
- `docker-compose.yml`
- `scripts/aws/ensure-connect-approved-origins.sh`
- `docs/operator-ccp-aws-cli-pass.md`
- `docs/aws-connect-approved-origin-check-2026-07-08.txt`
- `docs/AGENT_RUN_REPORT_2026-07-08_ccp_aws_origin_fix.md`

## Deploy / Build Env Changes

- Added `VITE_AMAZON_CONNECT_EMBEDDED_CCP_ENABLED=false` as a non-secret app build arg in `docker-compose.yml`.
- Added matching `ARG` and `ENV` wiring in `apps/app/Dockerfile`.
- Vite env is build-time. `VITE_AMAZON_CONNECT_EMBEDDED_CCP_ENABLED=false` must be present before `npm run build:app` or the Docker app build.
- If this flag is not exactly `true`, the app does not import `amazon-connect-streams` or call `connect.core.initCCP`.

## Commands Run / Results

- Required AWS CLI tee block: passed; output saved to `docs/aws-connect-approved-origin-check-2026-07-08.txt`.
- `npm run typecheck:app`: passed.
- `npm run build:app`: passed; Vite emitted the existing large chunk warning.
- Built bundle check: passed; Direct CCP production text exists, `Embedded CCP enabled` text exists, and raw `VITE_AMAZON_CONNECT_EMBEDDED_CCP_ENABLED` is not present in the built JS.
- `bash -n scripts/aws/ensure-connect-approved-origins.sh`: passed.
- `npm run typecheck:api`: passed.
- `npm run build:api`: passed.
- `npm run deploy:ec2`: passed.
  - Docker Compose built the app image with the app build arg.
  - Prisma migrate deploy reported no pending migrations.
  - `fastaibooking-app` container was recreated and started.
  - API health check passed.
  - nginx reload signal succeeded.
  - Deploy finished with `Deployment completed successfully.`
- Production static check:
  - `curl -L -sS -o /dev/null -w '%{http_code} %{url_effective}\n' https://app-new-nail.kendemo.com/call-center`: `200 https://app-new-nail.kendemo.com/call-center`
  - `curl -L -sS -o /dev/null -w '%{http_code}\n' https://api-new-nail.kendemo.com/health/liveness`: `200`
  - Production HTML references `/assets/index-BCzaGvS6.js`.
  - Production JS contains Direct CCP production text and embedded-enabled label.
  - Production JS still contains the optional `initCCP` implementation path because embedded mode remains available only when the build-time flag is exactly `true`.
- Production browser smoke:
  - Logged in via real API as `agent.demo@fastaibooking.local`.
  - Login role: `CALL_CENTER_AGENT`.
  - Browser: `Chrome/150.0.7871.100`.
  - URL loaded: `https://app-new-nail.kendemo.com/call-center`.
  - Direct CCP note present: yes.
  - Direct CCP mode text present: yes.
  - `Open Amazon Connect CCP` button present: yes.
  - `I already logged in / Refresh queue` button present: yes.
  - iframe count: `0`.
  - `.ccp-frame` count: `0`.
  - Open CCP action target: `https://fastaibooking.my.connect.aws/ccp-v2/`.
  - Relevant console messages matching `initCCP`, `ACK_TIMEOUT`, `frame-ancestors`, `Amazon Connect CCP`, or `connect-streams`: none.
- `git diff --check`: passed before deploy. Final `git diff --check` will be rerun after this report update.
- Final `git diff --check`: passed.

## Production Test Result

- Passed for the requested Direct CCP production behavior.
- Production `/call-center` shows Direct CCP controls for the real call-center agent login.
- No broken embedded iframe is rendered when `VITE_AMAZON_CONNECT_EMBEDDED_CCP_ENABLED=false`.
- No repeated `initCCP` / `ACK_TIMEOUT` spam was observed in the production browser smoke.
- The Direct CCP popup target resolves to `https://fastaibooking.my.connect.aws/ccp-v2/`.
- The smoke test confirmed the queue/call-handling screen remains connected to the real authenticated app session. It did not place a live phone call or create a new appointment, to avoid mutating production demo data outside the requested verification.

## Production Browser Smoke Raw Output

```json
{
  "loginStatus": 200,
  "loginRole": "CALL_CENTER_AGENT",
  "browser": "Chrome/150.0.7871.100",
  "parsedResult": {
    "url": "https://app-new-nail.kendemo.com/call-center",
    "title": "FastAIBooking",
    "hasDirectNote": true,
    "hasDirectModeText": true,
    "hasOpenButton": true,
    "hasRefreshButton": true,
    "iframeCount": 0,
    "ccpFrameCount": 0,
    "openedCcp": "https://fastaibooking.my.connect.aws/ccp-v2/",
    "controls": [
      "Mở Amazon Connect CCP",
      "Tôi đã đăng nhập / Refresh queue",
      "Mở Amazon Connect trong tab mới",
      "Nhận xử lý",
      "Lưu ghi chú",
      "Yêu cầu gọi lại",
      "Gửi SMS",
      "Hoàn tất",
      "Tạo khách hàng",
      "Tạo lịch hẹn",
      "Tải lại cuộc gọi"
    ]
  },
  "relevantConsole": [],
  "consoleCount": 0
}
```

## Remaining Blocker If Embedded CCP Still Fails

Embedded CCP can still fail with `frame-ancestors 'self'` until Amazon Connect effectively applies the iframe allowlist for the loaded CCP URL/instance in browser. Production Direct CCP mode avoids that blocker for demos and operator workflows.

## Exact Next Action

Use Direct CCP mode for the demo: open `/call-center`, click `Open Amazon Connect CCP`, log in to the Amazon Connect popup, set the agent Available, and keep the app dashboard open for queue, customer, appointment, note, callback, SMS, and completion actions. Re-enable embedded CCP only after Amazon Connect serves `https://fastaibooking.my.connect.aws/ccp-v2/` with an iframe allowlist that includes `https://app-new-nail.kendemo.com`.
