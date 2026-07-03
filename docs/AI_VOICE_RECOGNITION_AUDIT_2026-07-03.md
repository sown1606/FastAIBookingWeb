# AI Voice Recognition Audit

Date: 2026-07-03

## Log Files Inspected

- `ai-interactions-2026-06-04T03_53_34.856Z.json`
- `ai-interactions-2026-06-05T08_02_01.720Z.json`
- `ai-interactions-2026-06-05T16_30_31.586Z.json`
- `apps/api/docs/examples/transcript.sample.txt`
- `apps/api/docs/examples/booking-text.sample.txt`
- `apps/api/docs/examples/booking-unavailable.sample.json`
- `apps/api/docs/examples/booking-missing-info.sample.json`
- Existing Lambda/API call-flow tests and fixtures under `tests/lambda/` and `apps/api/test/`

## Problem Utterances Found

| Source | Actual recognized text | Expected interpretation |
| --- | --- | --- |
| `ai-interactions-2026-06-04T03_53_34.856Z.json` | `i want to have eddie here tomorrow at seven p.m. yes.` | Pedicure request, tomorrow at 7 PM, known caller Kiet by phone |
| `ai-interactions-2026-06-04T03_53_34.856Z.json` | `i want to have eddie here tomorrow at seven p.m. 1` | Pedicure request, tomorrow at 7 PM, option selection after an alternative prompt |
| `ai-interactions-2026-06-05T08_02_01.720Z.json` | Same two `eddie here` utterances | Same as above |
| `ai-interactions-2026-06-05T16_30_31.586Z.json` | Same two `eddie here` utterances, plus a later Kiet phone lookup record | Pedicure match and phone-based customer preservation |

The logs also showed bad customer name text (`chang`) on Kiet's known phone number. Current code already preserves the phone lookup name when the caller has not explicitly supplied another name; tests now cover this with a noisy `Kit`/bad slot value.

## Code Changes Made

- Added the conservative service-only alias `eddie here` for Pedicure in:
  - `infra/lambda/booking-handler/index.mjs`
  - `apps/api/src/modules/ai/ai.service.ts`
  - Lex v8/v10 `NailServiceType` exports
- Kept the alias scoped to service matching only. It is not used for staff matching or global name normalization.
- Preserved known caller name behavior: phone lookup remains authoritative unless an explicit name phrase is spoken.
- Lowered the Lambda backend wait timeout default from 3500 ms to 2800 ms to avoid unprompted DialogCodeHook waits exceeding 3 seconds.

## Normalization Aliases Added

- Pedicure: `eddie here`

Existing conservative Pedicure aliases remain: `pedi cure`, `peddy cure`, `pay di cure`, `pay the cure`, `better cure`, `ready cure`, `pretty cure`, `toe service`, `foot service`, and related variants.

## Tests Added or Updated

- `apps/api/test/ai-internal.test.ts`
  - `logged eddie here utterance matches Pedicure for known caller without overwriting Kiet`
  - `unrelated service noise does not map to Pedicure`
  - `new active bookable staff appears in staff DTMF prompt and books by digit`
- `tests/lambda/booking-handler.test.mjs`
  - `DialogCodeHook recovers logged eddie here pedicure utterance before staff lookup`

Existing tests continue to cover:

- `tomorrow at three PM`
- bare `one` through `seven` as PM where context is missing
- DTMF staff selection as primary path
- spoken staff-name fallback
- Kiet phone lookup preservation

## Remaining Risks

- `eddie here` is intentionally narrow. More aliases should only be added after real logs show repeated safe patterns.
- Lex confidence in production still depends on the published bot version and alias. The JSON exports were updated, but no deployment was performed.
- DialogCodeHook progress prompts are limited by Lex runtime behavior. Lambda now times out backend waits before 3 seconds by default, while fulfillment hooks still use Lex progress prompts.
