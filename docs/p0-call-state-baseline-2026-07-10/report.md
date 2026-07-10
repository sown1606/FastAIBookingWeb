# FastAIBooking P0 Call-State Baseline - 2026-07-10

This report was captured before source code edits for the P0 call-state repair.

## Git Baseline

- Branch: `main`
- HEAD: `242615d4f0ca8133f6fbf07ac60ba8adb6e1d8e8`
- Recent commits:
  - `242615d Stabilize phone booking and owner admin UX`
  - `503cd45 Stabilize owner appointments and database access`
  - `0ec62e4 Fix AI call flow staff resolution and prompt loop`
  - `bad9aac Fix staff-service defaults and booking mapping flow`
  - `6cf1893 Fix Amazon Connect customer name booking flow`
- Pre-existing local changes:
  - Modified: `fastaibooking-current-state.zip`
  - Untracked: `FastAIBooking-Codex-production-completion-prompt.md`
  - Untracked: `make-fastaibooking-diagnostic-bundle.sh`
  - Untracked: `make-fastaibooking-quick-zip.sh`

## Deployed API / Web Baseline

The EC2 production stack is running Docker Compose on `ubuntu@32.194.150.135`.

- API image: `sha256:17f084f15c65dcf0e65260b007b4cbbe2f4793b17620134a7558108a144fcd48`
- API image created: `2026-07-10T14:40:22.104402198Z`
- Admin image: `sha256:d10550eec1501bafa194ff9bc5a8ab0b411d1c815aadb59abb2ef988c1d9e5dc`
- Owner app image: `sha256:b32229c4161240afdb2221dee18cf816e76470b3e856e38a55d2a63e874feec2`
- Containers observed healthy/running: `fastaibooking-api`, `fastaibooking-app`, `fastaibooking-admin`, `fastaibooking-nginx`, `fastaibooking-postgres`, `fastaibooking-adminer`
- The deployed checkout did not expose a Git HEAD in the quick SSH inventory command, so image digests are the deployment identifiers for this baseline.

## Lambda Baseline

Live Lex alias uses this Lambda code hook:

- Function: `fastaibooking-booking-handler`
- ARN: `arn:aws:lambda:us-east-1:197452633989:function:fastaibooking-booking-handler`
- Version: `$LATEST`
- Runtime: `nodejs20.x`
- CodeSha256: `1XIHrPW3q4hdurJ+0X8etiarlvGR1lcvigvV6z9xth4=`
- LastModified: `2026-07-10T14:08:13.000+0000`
- State: `Active`
- LastUpdateStatus: `Successful`
- Backup metadata: `lambda-booking-handler.json`

## Lex Baseline

- Bot ID: `KHMIXGA2US`
- Bot name: `FastAIBookingBot`
- Locale: `en_US`
- Live alias: `prod`
- Alias ID: `JVIPIZDYE3`
- Alias ARN used by Connect source and live flow: `arn:aws:lex:us-east-1:197452633989:bot-alias/KHMIXGA2US/JVIPIZDYE3`
- Alias target version: `27`
- Locale status for version 27: `Built`
- Lambda code hook target: `arn:aws:lambda:us-east-1:197452633989:function:fastaibooking-booking-handler`
- `BookAppointmentIntent` ID in live version 27: `8DGNM1BMFC`
- `NailServiceType` slot type ID in live version 27: `CRPHEOWTHG`
- Live slot type has the current Full Set production aliases including `room set`, `pull set`, `pull step`, `pool set`, `full step`, and `full said`.
- Sanitized backup files:
  - `lex-prod-alias.json`
  - `lex-v27-locale.json`
  - `lex-v27-book-appointment-intent.json`
  - `lex-v27-nail-service-slot-type.json`
  - `lex-v27-export-metadata-sanitized.json`
  - `lex-v27-export-MGUKAEHRY6.zip`

## Lex Source Of Truth

The active live bot is `KHMIXGA2US` alias `JVIPIZDYE3` version `27`. The repository folder that matches this bot source is `infra/aws/lex/FastAIBookingBot-v10`. Older `v7` and `v8` folders are present but are not the active source for this incident unless explicitly promoted by a later maintenance workflow.

## Amazon Connect Baseline

- AWS account: `197452633989`
- AWS profile used for working credentials: `nailnew`
- Instance ID: `74f78377-766f-46b7-a745-4bc97b68a8dc`
- Contact flow: `FastAIBooking AI Reception`
- Flow ID: `dcccf542-587c-426c-a644-a4c6f24da6e4`
- Flow state/status: `ACTIVE` / `PUBLISHED`
- Live flow content hash: `fa4a67ae1e62f5272d5f78c48fffc044643c63a1d95285ea6b385e406142c87b`
- Exported live flow JSON: `connect-ai-reception-active.json`
- The live flow and source both reference Lex alias `arn:aws:lex:us-east-1:197452633989:bot-alias/KHMIXGA2US/JVIPIZDYE3`.
- Baseline risk confirmed: the primary `ConnectParticipantWithLexBot` action routes recognized intents to `check-transfer-to-queue`; that compare checks only `$.Lex.SessionAttributes.transferToQueue`. Non-transfer results fall through to the generic goodbye action.

## Production Salon Baseline

- Salon ID: `9bd14a12-85ed-418a-af7d-3f5cb329c147`
- Name: `Kiet Nails & Beauty`
- Status: `ACTIVE`
- Timezone: `America/New_York`
- Customer incoming phone: `+18483487681`
- Original phone: `+18487029493`

Business hours:

| dayOfWeek | isOpen | openTime | closeTime |
| --- | --- | --- | --- |
| 0 | true | 09:00 | 18:00 |
| 1 | true | 09:00 | 18:00 |
| 2 | true | 09:00 | 18:00 |
| 3 | true | 09:00 | 18:00 |
| 4 | true | 11:00 | 18:00 |
| 5 | false |  |  |
| 6 | true | 09:00 | 18:00 |

Active services:

- `Builder Gel Fill Update`, duration 30
- `Dip Powder`, duration 70
- `Full Set`, duration 100
- `Manicure`, duration 40
- `Other Services`, duration 60
- `Pedicure`, duration 45
- `filter`, duration 30

Active bookable staff:

- Alex
- Amy
- Kelly
- Linh
- Thien Le
- Trang
- `kenvin`

Staff-service assignments:

- All active staff listed above are assigned to all active services listed above, including Pedicure and Full Set.

## Data Notes For Repair

- `kenvin` is an active bookable staff record assigned to Pedicure. The likely public spelling is `Kevin`; repair should be documented with the staff ID `0227f285-efb4-47ac-bc01-82b2c0cec3f5` if performed.
- Business-hour rows exist for all seven weekdays. No missing-row initialization is required at baseline. Any later data repair should preserve the existing Thursday 11:00 opening and Friday closed state.

## Baseline Artifact Hashes

- `connect-ai-reception-active.json`: `fa4a67ae1e62f5272d5f78c48fffc044643c63a1d95285ea6b385e406142c87b`
- `lambda-booking-handler.json`: `66b6a9a8d1b1c62a8285e6794a2c53840a950ec0c553b91737c3373d92590099`
- `lex-prod-alias.json`: `54acad8300654fbf870b37504ae983d4c22410fe4446098296c28752c0db652f`
- `lex-v27-book-appointment-intent.json`: `9a4705dfcd76aee2d53bb49c96a82c809e70b08eceae36fac5377a77bb68f1e5`
- `lex-v27-locale.json`: `f2b18a89490a65628ac725a5afa9dca551c3c6dc1b266085eaf37bcfb2d22d89`
- `lex-v27-nail-service-slot-type.json`: `d390793a7522c43bdcc9b0f2159eeaa1d8afd476f716e92c2a49198bcac7c62f`
- `lex-v27-export-metadata-sanitized.json`: `19c1401ab7b5e5ac6316a21277266c3df1ce23be0d4f8aae55ebc694f174c7e7`
- `lex-v27-export-MGUKAEHRY6.zip`: `285b59be7da62d16b6dde28ed41377fb39a93840ad93f32162ac703b57770012`
