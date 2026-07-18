# Bao cao P0 call-state repair - 2026-07-10

## 1. Tinh trang truoc khi sua

- Branch: `main`; baseline HEAD truoc thay doi: `242615d4f0ca8133f6fbf07ac60ba8adb6e1d8e8`.
- Baseline san xuat da luu tai `docs/p0-call-state-baseline-2026-07-10/`, gom Connect flow, Lambda config, Lex alias/version/slot type export va bao cao sanitized.
- Connect flow live dung Lex alias `arn:aws:lex:us-east-1:197452633989:bot-alias/KHMIXGA2US/JVIPIZDYE3`, nhung nhanh chinh chi kiem tra `transferToQueue`; moi ket qua khong transfer co the roi vao cau goodbye.
- Lex live: bot `KHMIXGA2US`, alias `prod/JVIPIZDYE3`, version `27`, locale `en_US` Built, code hook Lambda `fastaibooking-booking-handler`.
- Lambda truoc deploy: `CodeSha256=1XIHrPW3q4hdurJ+0X8etiarlvGR1lcvigvV6z9xth4=`, `LastModified=2026-07-10T14:08:13.000+0000`.
- Kiet Nails & Beauty: salon ID `9bd14a12-85ed-418a-af7d-3f5cb329c147`, timezone `America/New_York`, business hours tu DB: Sun/Mon/Tue/Wed/Sat `09:00-18:00`, Thu `11:00-18:00`, Fri closed.

## 2. Nguyen nhan goc theo tung loi

- Premature goodbye: Connect flow coi "khong transfer" la ket thuc hoi thoai; thieu hop dong terminal ro rang giua Lambda/API va Connect.
- Vong lap ngoai gio: API kiem tra staff availability truoc business hours, nen 1 AM bi noi thanh nhan vien khong ranh thay vi salon dong cua; rejection khong xoa alternative offer.
- Exact-time/any-staff: alternative state bi tron voi `staffPreference` cu, nen he thong co the quay lai option 9 AM cu thay vi anchor 10 AM.
- Date corruption: time-only correction co the di qua parser mac dinh ngay hom nay; thieu phat hien field date/time hien dien trong current turn.
- Multi-field correction: final-confirmation classifier uu tien affirmative/deny hon slot change trong cau co nhieu field, va khong apply staff/time atomically.
- Kevin safety: trailing `okay` co the duoc xem nhu xac nhan stale state; staff matching khong co sua chinh ta an toan cho `kenvin` -> `Kevin`.
- Natural confirmation loop: exact anchored patterns nhan `correct` nhung co the bo qua cum nhu `yes this is correct` neu state/fingerprint khong dung.
- Full Set: cac alias speech da co gate test; tiep tuc giu chinh sach scoped, khong dua vao DTMF.

## 3. File va ham da thay doi

- `apps/api/src/modules/ai/ai.service.ts`: current-turn precedence, final confirmation classifier, fingerprint gate, date/time grounding, business-hours-before-availability, alternative rejection/no-loop, conservative staff fuzzy match, Kevin support, turn-state diagnostics.
- `apps/api/test/ai-internal.test.ts`: regression tests cho Full Set speech, natural confirmation, slot-change precedence, date preserve, business hours, alternative rejection, Kevin safety, idempotency.
- `infra/lambda/booking-handler/index.mjs`: conversation contract defaults va aligned final-confirmation classifier tai Lambda boundary.
- `infra/aws/connect/contact-flows/ai-reception.json`: them `conversationComplete` compare, route non-terminal ve Lex recovery, pass booking/session state qua recovery block.
- `tests/lambda/booking-handler.test.mjs`: static contact-flow graph tests cho transfer/complete/continue va no-match khong disconnect ngay.
- `docs/p0-call-state-baseline-2026-07-10/*`: baseline sanitized truoc khi deploy.
- `docs/p0-call-state-repair-report-2026-07-10.md`: bao cao nay.

## 4. Thay doi du lieu production

- Updated staff row: `0227f285-efb4-47ac-bc01-82b2c0cec3f5`, salon `9bd14a12-85ed-418a-af7d-3f5cb329c147`, `fullName: kenvin -> Kevin`.
- Audit row inserted: `staff-name-repair-20260710-kevin`, action `STAFF_NAME_CORRECTED`, entity `Staff`.
- Business-hour rows khong bi sua; baseline cho thay day du 7 ngay.
- Khong xoa call log, AI log, customer history, hoac appointment production.

## 5. Ket qua unit/integration/build

- `npm test`: PASS; Lambda `81/81`, API `121/121`.
- `npm run test:lambda`: PASS; `81/81`.
- `npm run test:api`: PASS; `121/121`.
- `npm run typecheck:api`: PASS.
- `npm run build:api`: PASS.
- `npm run typecheck:app`: PASS.
- `npm run build:app`: PASS, co Vite chunk-size warning hien huu.
- `npm run typecheck:admin`: PASS.
- `npm run build:admin`: PASS, co Vite chunk-size warning hien huu.
- `node --check infra/lambda/booking-handler/index.mjs`: PASS.
- `jq empty infra/aws/connect/contact-flows/ai-reception.json`: PASS.
- `git diff --check`: PASS.

## 6. Tai nguyen da deploy

- API container: `sha256:2d5e944b6f06c02a360f3ffbe0e4dd9f561723f0db2834127a213b43c00ef0b3`, created `2026-07-10T19:02:22.600793731Z`, health `healthy`.
- Lambda: `arn:aws:lambda:us-east-1:197452633989:function:fastaibooking-booking-handler`, version `$LATEST`, `CodeSha256=OUEQkvAsRQ80NSgyBaM39CvyiX1r0/v7aSPFqLlWVcU=`, `LastModified=2026-07-10T18:51:44.000+0000`, update status `Successful`.
- Lex: alias `prod/JVIPIZDYE3` van tro toi bot version `27`, status `Available`; locale version `27/en_US` status `Built`; code hook tro toi Lambda ARN tren. Khong publish version Lex moi vi model/slot type live khong doi va DRAFT khong duoc coi la source of truth cho incident nay.
- Connect flow: `arn:aws:connect:us-east-1:197452633989:instance/74f78377-766f-46b7-a745-4bc97b68a8dc/contact-flow/dcccf542-587c-426c-a644-a4c6f24da6e4`, status `PUBLISHED`, state `ACTIVE`, content sha256 `5e22b84c1fcc0b88c55b07aff24fd120b6abc5e59d107e5b6037a231c9f6a878`.
- Admin container unchanged: `sha256:d10550eec1501bafa194ff9bc5a8ab0b411d1c815aadb59abb2ef988c1d9e5dc`.
- Owner app container unchanged: `sha256:b32229c4161240afdb2221dee18cf816e76470b3e856e38a55d2a63e874feec2`.

## 7. Bang chung call that sau deploy

FAIL - BLOCKED ON LIVE CALL VERIFICATION.

Khong co kha nang originate/receive PSTN call tu moi truong Codex hien tai. Vi vay khong co ContactId moi tu call that, khong co transcript call that, va khong co appointmentId tao boi caller noi natural affirmative. Khong duoc coi production voice acceptance la PASS.

Smoke production khong tao lich:

- Synthetic ContactId: `codex-prod-smoke-20260710-diag2`.
- Input qua Lambda/API: `Hi, I want to book Full Set tomorrow at 3 PM with Trang.`
- Slot state: `serviceName=Full Set`, `requestedDate=2026-07-11`, `requestedTime=3 PM`, `staffPreference=Trang`, `conversationComplete=false`.
- Confirmation fingerprint: `3e430534aa1cbb848faf2d96adc5e3e30460f23bba6b94407798887917fcc7dd`.
- AI log rows: `1`; appointments created: `0`.
- Export diagnostics present: `turnStateDiagnostics.conversationCompleteAfter=false`, response fingerprint `2e5eb5791a45c793ce7da0f1aa3051eaffd3b6bbe47cad376b0f1c575001265b`.

## 8. ContactId va appointmentId moi

- New real post-deploy ContactId: FAIL - khong co vi live call verification bi chan.
- New real appointmentId sau cau `Yes, this is correct`: FAIL - khong co vi live call verification bi chan.
- Synthetic smoke ContactIds da tao log, khong tinh la acceptance: `codex-prod-smoke-20260710-fullset`, `codex-prod-smoke-20260710-diag`, `codex-prod-smoke-20260710-diag2`.

## 9. Kiem tra khong tao lich trung

- Unit/integration: PASS cho duplicate fulfillment/retry, one AI log row per ContactId, confirmed booking retry tra cung appointment.
- Production smoke: PASS cho truong hop khong booking; ContactId `codex-prod-smoke-20260710-diag2` tao `1` AI log row, `1` booking attempt, `0` appointment.
- Live real-call duplicate check: FAIL - BLOCKED ON LIVE CALL VERIFICATION.

## 10. Rollback plan

- API: redeploy source tu HEAD truoc baseline `242615d4f0ca8133f6fbf07ac60ba8adb6e1d8e8` hoac rebuild lai image truoc do `sha256:17f084f15c65dcf0e65260b007b4cbbe2f4793b17620134a7558108a144fcd48` neu con trong Docker cache.
- Lambda: upload lai zip/source baseline; CodeSha256 truoc do `1XIHrPW3q4hdurJ+0X8etiarlvGR1lcvigvV6z9xth4=`.
- Connect: import lai `docs/p0-call-state-baseline-2026-07-10/connect-ai-reception-active.json`.
- Lex: alias hien van version `27`; rollback Lex khong can thiet tru khi alias bi thay doi ngoai dot nay.
- Data: neu chu salon xac nhan ten cong khai khong phai Kevin, revert staff row `0227f285-efb4-47ac-bc01-82b2c0cec3f5` ve gia tri mong muon va ghi audit log tuong ung.

## 11. Rui ro con lai / viec bi chan

- BLOCKED ON LIVE CALL VERIFICATION: can nguoi co kha nang goi so Connect `+********7681` thuc hien 7 gate trong prompt va cung cap ContactId moi.
- Owner/admin follow-up bi hoan theo yeu cau vi voice live gates chua PASS: chua expose Business Hours trong basic mode, chua verify JSON export bang browser sau deploy, chua responsive smoke UI.
- CloudWatch quick filter tren Lambda log group khong tra snippet cho cac ContactId cu trong thoi gian chay lenh; regression duoc bao ve bang tests/source va DB baseline thay vi log excerpt moi.

## Bang PASS/FAIL bat buoc

| Hang muc | Source/test | Live |
| --- | --- | --- |
| premature goodbye | PASS static graph | FAIL - BLOCKED ON LIVE CALL VERIFICATION |
| existing appointment versus new booking | PASS API tests | FAIL - BLOCKED ON LIVE CALL VERIFICATION |
| 1 AM outside-hours explanation | PASS API test | FAIL - BLOCKED ON LIVE CALL VERIFICATION |
| 10 AM exact-time/any-staff handling | PASS API tests | FAIL - BLOCKED ON LIVE CALL VERIFICATION |
| alternative rejection/no-loop | PASS API test | FAIL - BLOCKED ON LIVE CALL VERIFICATION |
| time-only correction preserves date | PASS API test | FAIL - BLOCKED ON LIVE CALL VERIFICATION |
| multi-field time+staff correction | PASS API test | FAIL - BLOCKED ON LIVE CALL VERIFICATION |
| Kevin safety | PASS API test va data repair | FAIL - BLOCKED ON LIVE CALL VERIFICATION |
| Full Set speech-only | PASS Lambda/API tests va production smoke | FAIL - BLOCKED ON LIVE CALL VERIFICATION |
| compound confirmation | PASS Lambda/API tests | FAIL - BLOCKED ON LIVE CALL VERIFICATION |
| DTMF 0 | PASS Lambda tests | FAIL - BLOCKED ON LIVE CALL VERIFICATION |
| idempotent booking | PASS API tests | FAIL - BLOCKED ON LIVE CALL VERIFICATION |
| call/AI log JSON export | FAIL - follow-up gated sau live voice | FAIL - BLOCKED ON LIVE CALL VERIFICATION |
