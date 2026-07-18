# AI call booking Full Set/wait fix run report

## Status

Completed and deployed on 2026-07-08 UTC.

## Root cause

- Full Set speech aliases were too narrow in the Lambda/API deterministic matchers and Lex slot type, so clear caller speech could miss service resolution and fall into service retry/DTMF.
- Scoped DTMF digit `4` selected Full Set, but the digit was also being retained as free-form booking text. That allowed `4` to be parsed as a time and could pollute later name/date recovery.
- Lambda booking fulfillment was stripping or blocking backend-provided human-transfer attributes for booking outcomes, which could prevent safe backend-failure handoff.
- The live Connect Lex-error branch ended the call with a callback/goodbye style prompt instead of a wait-and-transfer fallback.
- Live Lex prod had an older `serviceName` retry prompt. Slot type aliases were fixed first in version 16; prompt wording required an additional slot prompt update and version 17.

## Live checks

- Initial AWS/log capture saved to `docs/call-flow-thuyet-live-check-2026-07-08.txt`.
- Production DB/result export saved to `docs/call-flow-thuyet-data-2026-07-08.json`.
- DB export source: read-only psql through EC2/Postgres. Counts: 19 call sessions, 14 booking attempts, 17 AI interaction logs, 8 transcripts.
- Exact phrase `AI services not available` was not found in the active repo call-flow files or live log sweeps. A similar Connect Lex-error goodbye branch was found and replaced with wait-and-transfer.

## Files changed

- `infra/lambda/booking-handler/index.mjs`
- `apps/api/src/modules/ai/ai.service.ts`
- `infra/aws/lex/FastAIBookingBot-v10/BotLocales/en_US/SlotTypes/NailServiceType/SlotType.json`
- `infra/aws/connect/contact-flows/ai-reception.json`
- `tests/lambda/booking-handler.test.mjs`
- `apps/api/test/ai-internal.test.ts`
- `docs/AI_CALL_BOOKING_WORKFLOW_AUDIT.md`
- `docs/call-flow-thuyet-live-check-2026-07-08.txt`
- `docs/call-flow-thuyet-data-2026-07-08.json`
- `docs/AGENT_RUN_REPORT_2026-07-08_call_flow_full_set_wait_fix.md`

## Fix summary

- Added Full Set aliases: full set, fullset, full-set, full sets, full nail set, nail full set, full nail, nail set, new set, complete set, false set, fall set, four set, full said, full sat, full sad, full send, fuel set, fake nails, extension nails, nail extensions, full set appointment.
- DTMF 4 now sets and preserves `serviceName=Full Set` and `confirmedServiceName=Full Set`; scoped DTMF digits are no longer parsed as booking text.
- Backend timeout, unreachable, and not-configured errors now preserve distinct escalation reasons and return a wait transfer message instead of `Failed`.
- Lambda now honors backend/API human escalation transfer attributes for booking responses.
- Connect AI reception Lex-error branch now says: `This is taking longer than expected. Please wait while I connect you to our team.` and transfers to the human escalation flow.
- Lex prod alias now points to version 17 with Full Set slot aliases and retry prompt wording.

## Validation

- `npm run test:lambda`: pass, 37/37.
- `npm run test:api`: pass, 69/69.
- `npm run typecheck:api`: pass.
- `npm run build:api`: pass.
- `git diff --check`: pass.
- Post-deploy API health: pass.
- Post-deploy Lex runtime speech smoke: `I want to book a full set` resolved `serviceName` to `Full Set`.
- Post-deploy live Lambda scoped DTMF smoke: `4` set Full Set; follow-up `my name is Thuyet` kept Full Set and filled `customerName`; follow-up `tomorrow at 3 PM` kept Full Set and filled date/time.

## Deploy result

- Commit: `6a107b3765cea314c290e9b696a1e8ecbbdf35e9`.
- Lambda `fastaibooking-booking-handler` updated at `2026-07-08T18:37:46.000+0000`.
- Connect flow `FastAIBooking AI Reception` updated and remains `ACTIVE`/`PUBLISHED`.
- API deployed by rebuilding/restarting only the `api` Docker Compose service; container became healthy.
- Lex draft updated, built, published as versions 16 and 17; prod alias `JVIPIZDYE3` now points to version 17.

## Remaining risk

- I could not place an actual phone call from this environment. I ran live Lex runtime and Lambda/Connect/API verification instead.
- Raw Lex runtime text `4` without an active service prompt routes to fallback; scoped Connect/Lex DTMF state was verified by live Lambda invocation with `lastAskedSlot=serviceName`.
- Historical DB records still contain legacy service wording as stored production history; no production data was changed or deleted.

## Evidence log


## Deploy Lambda booking handler
Wed Jul  8 18:37:43 UTC 2026
{
    "FunctionName": "fastaibooking-booking-handler",
    "FunctionArn": "arn:aws:lambda:us-east-1:197452633989:function:fastaibooking-booking-handler",
    "Runtime": "nodejs20.x",
    "Role": "arn:aws:iam::197452633989:role/service-role/fastaibooking-booking-handler-role-e3acnre0",
    "Handler": "index.handler",
    "CodeSize": 14200,
    "Description": "",
    "Timeout": 15,
    "MemorySize": 128,
    "LastModified": "2026-07-08T18:37:46.000+0000",
    "CodeSha256": "gSYcd/qfnTBwtTXPj8ViJMzCNPNHgCVS4RqJHA8DpOk=",
    "Version": "$LATEST",
    "Environment": "[redacted; sanitized after AWS returned variable values]",
    "TracingConfig": {
        "Mode": "PassThrough"
    },
    "RevisionId": "a59b7b1e-8819-41be-9986-8f1e50df65e2",
    "State": "Active",
    "LastUpdateStatus": "InProgress",
    "LastUpdateStatusReason": "The function is being created.",
    "LastUpdateStatusReasonCode": "Creating",
    "PackageType": "Zip",
    "Architectures": [
        "x86_64"
    ],
    "EphemeralStorage": {
        "Size": 512
    },
    "SnapStart": {
        "ApplyOn": "None",
        "OptimizationStatus": "Off"
    },
    "RuntimeVersionConfig": {
        "RuntimeVersionArn": "arn:aws:lambda:us-east-1::runtime:18671876e7cc385452255180c58ca50cf8763398a4248ae92ed14410d196b942"
    },
    "LoggingConfig": {
        "LogFormat": "Text",
        "LogGroup": "/aws/lambda/fastaibooking-booking-handler"
    }
}
{
    "FunctionName": "fastaibooking-booking-handler",
    "LastModified": "2026-07-08T18:37:46.000+0000",
    "Runtime": "nodejs20.x",
    "Handler": "index.handler",
    "Timeout": 15
}

## Deploy Connect AI reception contact flow
Wed Jul  8 18:38:24 UTC 2026
{
    "Name": "FastAIBooking AI Reception",
    "Id": "dcccf542-587c-426c-a644-a4c6f24da6e4",
    "State": "ACTIVE",
    "Status": "PUBLISHED",
    "LastModifiedTime": null
}

## Deploy Lex Full Set slot aliases to draft
Wed Jul  8 18:38:46 UTC 2026

Parameter validation failed:
Invalid type for parameter valueSelectionSetting.advancedRecognitionSetting, value: None, type: <class 'NoneType'>, valid types: <class 'dict'>
Invalid type for parameter valueSelectionSetting.regexFilter, value: None, type: <class 'NoneType'>, valid types: <class 'dict'>
{
    "botId": "KHMIXGA2US",
    "botVersion": "DRAFT",
    "localeId": "en_US",
    "botLocaleStatus": "Building"
}

## Wait for Lex build after null-field update attempt
Wed Jul  8 18:39:02 UTC 2026
zsh:5: read-only variable: status

## Wait for Lex build after null-field update attempt retry
Wed Jul  8 18:39:16 UTC 2026
attempt=1 status=ReadyExpressTesting
attempt=2 status=ReadyExpressTesting
attempt=3 status=Built

## Deploy Lex Full Set slot aliases to draft (sanitized value selection)
Wed Jul  8 18:39:44 UTC 2026

An error occurred (ValidationException) when calling the UpdateSlotType operation: 1 validation error detected: Value at 'valueSelectionSetting.resolutionStrategy' failed to satisfy constraint: Member must satisfy enum value set: [OriginalValue, TopResolution, Concatenation]

## Deploy Lex Full Set slot aliases to draft (TopResolution enum)
Wed Jul  8 18:40:03 UTC 2026
{
    "slotTypeId": "CRPHEOWTHG",
    "slotTypeName": "NailServiceType",
    "botId": "KHMIXGA2US",
    "botVersion": "DRAFT",
    "localeId": "en_US"
}
{
    "botId": "KHMIXGA2US",
    "botVersion": "DRAFT",
    "localeId": "en_US",
    "botLocaleStatus": "Building"
}

## Wait for Lex build after Full Set alias update
Wed Jul  8 18:40:17 UTC 2026
attempt=1 status=Building
attempt=2 status=ReadyExpressTesting
attempt=3 status=ReadyExpressTesting
attempt=4 status=ReadyExpressTesting
attempt=5 status=Built

## Publish Lex bot version and update prod alias
Wed Jul  8 18:41:02 UTC 2026
{
    "botId": "KHMIXGA2US",
    "botVersion": "16",
    "botStatus": "Versioning"
}
version=16 attempt=1 status=Creating
version=16 attempt=2 status=Available

Parameter validation failed:
Missing required parameter in botAliasLocaleSettings.botAliasLocaleSettings: "enabled"
Unknown parameter in botAliasLocaleSettings.botAliasLocaleSettings: "en_US", must be one of: enabled, codeHookSpecification

## Update Lex prod alias to version 16 retry
Wed Jul  8 18:41:28 UTC 2026
{
    "botAliasId": "JVIPIZDYE3",
    "botAliasName": "prod",
    "botVersion": "16",
    "botAliasStatus": "Available"
}
attempt=1 status=Available version=16

## Deploy API service only to EC2
Wed Jul  8 18:41:47 UTC 2026
time="2026-07-08T18:41:57Z" level=warning msg="Docker Compose is configured to build using Bake, but buildx isn't installed"
#0 building with "default" instance using docker driver

#1 [api internal] load build definition from Dockerfile
#1 transferring dockerfile: 829B done
#1 DONE 0.0s

#2 [api internal] load metadata for docker.io/library/node:20-bookworm-slim
#2 DONE 0.0s

#3 [api internal] load .dockerignore
#3 transferring context: 138B done
#3 DONE 0.0s

#4 [api build  1/11] FROM docker.io/library/node:20-bookworm-slim
#4 DONE 0.0s

#5 [api internal] load build context
#5 transferring context: 818.28kB 0.0s done
#5 DONE 0.1s

#6 [api build  3/11] RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
#6 CACHED

#7 [api build  4/11] COPY apps/api/package.json ./package.json
#7 CACHED

#8 [api build  5/11] RUN npm install
#8 CACHED

#9 [api build  6/11] COPY apps/api/tsconfig.json ./tsconfig.json
#9 CACHED

#10 [api build  7/11] COPY apps/api/prisma ./prisma
#10 CACHED

#11 [api build  2/11] WORKDIR /app
#11 CACHED

#12 [api build  8/11] COPY apps/api/scripts ./scripts
#12 CACHED

#13 [api build  9/11] COPY apps/api/src ./src
#13 DONE 0.1s

#14 [api build 10/11] RUN npm run prisma:generate
#14 0.755
#14 0.755 > @fastaibooking/api@1.0.0 prisma:generate
#14 0.755 > prisma generate
#14 0.755
#14 1.643 Prisma schema loaded from prisma/schema.prisma
#14 3.613
#14 3.613 ✔ Generated Prisma Client (v5.22.0) to ./node_modules/@prisma/client in 785ms
#14 3.613
#14 3.613 Start by importing your Prisma Client (See: https://pris.ly/d/importing-client)
#14 3.613
#14 3.613 Tip: Easily identify and fix slow SQL queries in your app. Optimize helps you enhance your visibility: https://pris.ly/--optimize
#14 3.613
#14 3.808 npm notice
#14 3.808 npm notice New major version of npm available! 10.8.2 -> 11.18.0
#14 3.808 npm notice Changelog: https://github.com/npm/cli/releases/tag/v11.18.0
#14 3.808 npm notice To update run: npm install -g npm@11.18.0
#14 3.808 npm notice
#14 DONE 3.9s

#15 [api build 11/11] RUN npm run build
#15 0.396
#15 0.396 > @fastaibooking/api@1.0.0 build
#15 0.396 > tsc -p tsconfig.json
#15 0.396
#15 DONE 13.4s

#16 [api runtime 3/8] RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
#16 CACHED

#17 [api runtime 4/8] COPY --from=build /app/package.json ./package.json
#17 CACHED

#18 [api runtime 5/8] COPY --from=build /app/node_modules ./node_modules
#18 CACHED

#19 [api runtime 6/8] COPY --from=build /app/prisma ./prisma
#19 CACHED

#20 [api runtime 7/8] COPY --from=build /app/scripts ./scripts
#20 CACHED

#21 [api runtime 8/8] COPY --from=build /app/dist ./dist
#21 DONE 0.1s

#22 [api] exporting to image
#22 exporting layers 0.1s done
#22 writing image sha256:038f024fbbf929d118894470257d13aee426c18be4aa8783d3d3da530a746776
#22 writing image sha256:038f024fbbf929d118894470257d13aee426c18be4aa8783d3d3da530a746776 0.0s done
#22 naming to docker.io/library/fastaibooking-api done
#22 DONE 0.1s

#23 [api] resolving provenance for metadata file
#23 DONE 0.0s
 api  Built
 Container fastaibooking-postgres  Running

> @fastaibooking/api@1.0.0 prisma:migrate:deploy
> prisma migrate deploy

Prisma schema loaded from prisma/schema.prisma
Datasource "db": PostgreSQL database "fastaibooking", schema "public" at "postgres:5432"

13 migrations found in prisma/migrations


No pending migrations to apply.
npm notice
npm notice New major version of npm available! 10.8.2 -> 11.18.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v11.18.0
npm notice To update run: npm install -g npm@11.18.0
npm notice
 Container fastaibooking-postgres  Running
 Container fastaibooking-api  Recreate
 Container fastaibooking-app  Running
 Container fastaibooking-admin  Running
 Container fastaibooking-api  Recreated
 Container fastaibooking-nginx  Running
 Container fastaibooking-postgres  Waiting
 Container fastaibooking-postgres  Healthy
 Container fastaibooking-api  Starting
 Container fastaibooking-api  Started
 Container fastaibooking-api  Waiting
 Container fastaibooking-api  Healthy
NAME                  IMAGE               COMMAND                  SERVICE   CREATED          STATUS                    PORTS
fastaibooking-api     fastaibooking-api   "docker-entrypoint.s…"   api       17 seconds ago   Up 15 seconds (healthy)   3000/tcp
fastaibooking-nginx   nginx:1.27-alpine   "/docker-entrypoint.…"   nginx     3 months ago     Up 9 days                 0.0.0.0:80->80/tcp, [::]:80->80/tcp, 0.0.0.0:443->443/tcp, [::]:443->443/tcp

## Post-deploy live AWS verification
Wed Jul  8 18:42:58 UTC 2026
### Lambda configuration
{
    "FunctionName": "fastaibooking-booking-handler",
    "LastModified": "2026-07-08T18:37:46.000+0000",
    "Runtime": "nodejs20.x",
    "Handler": "index.handler",
    "Timeout": 15
}
### Lex prod alias
{
    "botAliasName": "prod",
    "botVersion": "16",
    "botAliasStatus": "Available"
}
### Lex version 16 Full Set synonyms
[
    {
        "sampleValue": {
            "value": "Full Set"
        },
        "synonyms": [
            {
                "value": "4"
            },
            {
                "value": "full set"
            },
            {
                "value": "fullset"
            },
            {
                "value": "full-set"
            },
            {
                "value": "full sets"
            },
            {
                "value": "full nail set"
            },
            {
                "value": "nail full set"
            },
            {
                "value": "full nail"
            },
            {
                "value": "nail set"
            },
            {
                "value": "new set"
            },
            {
                "value": "complete set"
            },
            {
                "value": "false set"
            },
            {
                "value": "fall set"
            },
            {
                "value": "four set"
            },
            {
                "value": "full said"
            },
            {
                "value": "full sat"
            },
            {
                "value": "full sad"
            },
            {
                "value": "full send"
            },
            {
                "value": "fuel set"
            },
            {
                "value": "fake nails"
            },
            {
                "value": "extension nails"
            },
            {
                "value": "nail extensions"
            },
            {
                "value": "full set appointment"
            }
        ]
    }
]
### Connect AI error branch content
{
  "Identifier": "41e3f239-5b57-4363-92fc-9d594579fa98",
  "Type": "MessageParticipant",
  "Parameters": {
    "SkipWhenDTMFBufferEnabled": "false",
    "Text": "This is taking longer than expected. Please wait while I connect you to our team."
  },
  "Transitions": {
    "NextAction": "transfer-human-escalation-flow",
    "Errors": [
      {
        "NextAction": "transfer-human-escalation-flow",
        "ErrorType": "NoMatchingError"
      }
    ]
  }
}
### API health
{"success":true,"message":"Success","data":{"status":"ok","timestamp":"2026-07-08T18:43:06.864Z"}}
## Post-deploy Lex runtime smoke tests
Wed Jul  8 18:43:21 UTC 2026

### Full Set speech
Input: I want to book a full set
{
    "messages": [
        {
            "content": "Your name?",
            "contentType": "PlainText"
        }
    ],
    "sessionState": {
        "dialogAction": {
            "type": "ElicitSlot",
            "slotToElicit": "customerName"
        },
        "intent": {
            "name": "BookAppointmentIntent",
            "slots": {
                "customerName": null,
                "customerPhone": null,
                "requestedDate": null,
                "requestedTime": null,
                "serviceName": {
                    "value": {
                        "originalValue": "full set",
                        "interpretedValue": "Full Set",
                        "resolvedValues": [
                            "Full Set"
                        ]
                    }
                },
                "staffPreference": null
            },
            "state": "InProgress",
            "confirmationState": "None"
        },
        "sessionAttributes": {},
        "originatingRequestId": "469b9cb0-463d-4d1a-9cbb-cfcd34b7b062"
    }
}

### DTMF 4 initial
Input: 4
{
    "messages": null,
    "sessionState": {
        "dialogAction": {
            "type": "Close"
        },
        "intent": {
            "name": "FallbackIntent",
            "slots": {},
            "state": "ReadyForFulfillment",
            "confirmationState": "None"
        },
        "sessionAttributes": {},
        "originatingRequestId": "dc8fdcad-c516-4c07-a975-d716c82fa4e1"
    }
}

### DTMF 4 then name
Input: my name is Thuyet
{
    "messages": [
        {
            "content": "Sorry, I did not catch the service. Please press 1 for Pedicure, 2 for Manicure, 3 for Gel Manicure, 4 for Acrylic\u0020Full\u0020Set, 5 for Dip Powder, or 0 for an operator.",
            "contentType": "PlainText"
        }
    ],
    "sessionState": {
        "dialogAction": {
            "type": "ElicitSlot",
            "slotToElicit": "serviceName"
        },
        "intent": {
            "name": "BookAppointmentIntent",
            "slots": {
                "customerName": null,
                "customerPhone": null,
                "requestedDate": null,
                "requestedTime": null,
                "serviceName": null,
                "staffPreference": null
            },
            "state": "InProgress",
            "confirmationState": "None"
        },
        "sessionAttributes": {},
        "originatingRequestId": "dc8fdcad-c516-4c07-a975-d716c82fa4e1"
    }
}

### DTMF 4 then date
Input: 4
{
    "messages": null,
    "sessionState": {
        "dialogAction": {
            "type": "Close"
        },
        "intent": {
            "name": "FallbackIntent",
            "slots": {},
            "state": "ReadyForFulfillment",
            "confirmationState": "None"
        },
        "sessionAttributes": {},
        "originatingRequestId": "1da2ee10-f4e2-4e41-b230-b2ae995c1e6c"
    }
}

### DTMF 4 date follow-up
Input: tomorrow at 3 PM
{
    "messages": [
        {
            "content": "Sorry, I did not catch the service. Please press 1 for Pedicure, 2 for Manicure, 3 for Gel Manicure, 4 for Acrylic\u0020Full\u0020Set, 5 for Dip Powder, or 0 for an operator.",
            "contentType": "PlainText"
        }
    ],
    "sessionState": {
        "dialogAction": {
            "type": "ElicitSlot",
            "slotToElicit": "serviceName"
        },
        "intent": {
            "name": "BookAppointmentIntent",
            "slots": {
                "customerName": null,
                "customerPhone": null,
                "requestedDate": null,
                "requestedTime": {
                    "value": {
                        "originalValue": "3 PM",
                        "interpretedValue": "15:00",
                        "resolvedValues": [
                            "15:00"
                        ]
                    }
                },
                "serviceName": null,
                "staffPreference": null
            },
            "state": "InProgress",
            "confirmationState": "None"
        },
        "sessionAttributes": {},
        "originatingRequestId": "1da2ee10-f4e2-4e41-b230-b2ae995c1e6c"
    }
}

### Operator zero
Input: 0
{
    "messages": null,
    "sessionState": {
        "dialogAction": {
            "type": "Close"
        },
        "intent": {
            "name": "FallbackIntent",
            "slots": {},
            "state": "ReadyForFulfillment",
            "confirmationState": "None"
        },
        "sessionAttributes": {},
        "originatingRequestId": "7bde3034-ea73-488d-b653-8e79a6814e9a"
    }
}

## Deploy Lex serviceName prompt wording to draft
Wed Jul  8 18:44:45 UTC 2026
{
    "slotId": "GHZKSCLGQP",
    "slotName": "serviceName",
    "botId": "KHMIXGA2US",
    "botVersion": "DRAFT",
    "localeId": "en_US",
    "intentId": "8DGNM1BMFC"
}
{
    "botId": "KHMIXGA2US",
    "botVersion": "DRAFT",
    "localeId": "en_US",
    "botLocaleStatus": "Building"
}

## Wait for Lex build after serviceName prompt update
Wed Jul  8 18:44:59 UTC 2026
attempt=1 status=Building
attempt=2 status=ReadyExpressTesting
attempt=3 status=ReadyExpressTesting
attempt=4 status=ReadyExpressTesting
attempt=5 status=Built

## Publish Lex bot version 17 and update prod alias
Wed Jul  8 18:45:42 UTC 2026
{
    "botId": "KHMIXGA2US",
    "botVersion": "17",
    "botStatus": "Versioning"
}
version=17 attempt=1 status=Creating
version=17 attempt=2 status=Available
{
    "botAliasId": "JVIPIZDYE3",
    "botAliasName": "prod",
    "botVersion": "17",
    "botAliasStatus": "Available"
}

## Post-deploy Lex runtime smoke tests after prompt update
Wed Jul  8 18:46:12 UTC 2026
### Lex Full Set speech
{
    "messages": [
        {
            "content": "Your name?",
            "contentType": "PlainText"
        }
    ],
    "sessionState": {
        "dialogAction": {
            "type": "ElicitSlot",
            "slotToElicit": "customerName"
        },
        "intent": {
            "name": "BookAppointmentIntent",
            "slots": {
                "customerName": null,
                "customerPhone": null,
                "requestedDate": null,
                "requestedTime": null,
                "serviceName": {
                    "value": {
                        "originalValue": "full set",
                        "interpretedValue": "Full Set",
                        "resolvedValues": [
                            "Full Set"
                        ]
                    }
                },
                "staffPreference": null
            },
            "state": "InProgress",
            "confirmationState": "None"
        },
        "sessionAttributes": {},
        "originatingRequestId": "1d1fec9e-2554-4d00-87d4-5e176aaa818d"
    }
}
### Lex prompt wording retry check
{
    "messages": [
        {
            "content": "Sorry, I did not catch the service. Please press 1 for Pedicure, 2 for Manicure, 3 for Gel Manicure, 4 for Full Set, 5 for Dip Powder, or 0 for an operator.",
            "contentType": "PlainText"
        }
    ],
    "sessionState": {
        "dialogAction": {
            "type": "ElicitSlot",
            "slotToElicit": "serviceName"
        },
        "intent": {
            "name": "BookAppointmentIntent",
            "slots": {
                "customerName": null,
                "customerPhone": null,
                "requestedDate": null,
                "requestedTime": null,
                "serviceName": null,
                "staffPreference": null
            },
            "state": "InProgress",
            "confirmationState": "None"
        },
        "sessionAttributes": {},
        "originatingRequestId": "90938639-7c5e-4598-8be7-9394b547adb8"
    }
}

## Post-deploy live Lambda scoped DTMF smoke tests
Wed Jul  8 18:46:57 UTC 2026

### dtmf4
{
    "StatusCode": 200,
    "FunctionError": null
}
{
  "messages": [
    {
      "contentType": "PlainText",
      "content": "What day would you like to come in? Press 0 to speak with an operator."
    }
  ],
  "sessionAttributes": {
    "salonId": "9bd14a12-85ed-418a-af7d-3f5cb329c147",
    "CalledNumber": "+********7681",
    "CustomerEndpointAddress": "+********7681",
    "AmazonConnectContactId": "live-lambda-dtmf-20260708",
    "lastAskedSlot": "requestedDate",
    "customerPhone": "+********7681",
    "serviceName": "Full Set",
    "confirmedServiceName": "Full Set",
    "askedSlotsCount": "1",
    "fallbackCount": "1",
    "errorCount": "1"
  },
  "dialogAction": {
    "type": "ElicitSlot",
    "slotToElicit": "requestedDate"
  },
  "slots": {
    "customerPhone": {
      "shape": "Scalar",
      "value": {
        "originalValue": "+********7681",
        "interpretedValue": "+********7681",
        "resolvedValues": [
          "+********7681"
        ]
      }
    },
    "serviceName": {
      "shape": "Scalar",
      "value": {
        "originalValue": "Full Set",
        "interpretedValue": "Full Set",
        "resolvedValues": [
          "Full Set"
        ]
      }
    },
    "requestedDate": null
  }
}

### dtmf-name
{
    "StatusCode": 200,
    "FunctionError": null
}
{
  "messages": [
    {
      "contentType": "PlainText",
      "content": "Could you repeat the appointment date? Press 0 to speak with an operator."
    }
  ],
  "sessionAttributes": {
    "salonId": "9bd14a12-85ed-418a-af7d-3f5cb329c147",
    "CalledNumber": "+********7681",
    "CustomerEndpointAddress": "+********7681",
    "AmazonConnectContactId": "live-lambda-dtmf-20260708",
    "lastAskedSlot": "requestedDate",
    "serviceName": "Full Set",
    "confirmedServiceName": "Full Set",
    "customerName": "Thuyet",
    "customerPhone": "+********7681",
    "initialBookingUtterance": "my name is Thuyet",
    "askedSlotsCount": "1",
    "fallbackCount": "1",
    "errorCount": "1"
  },
  "dialogAction": {
    "type": "ElicitSlot",
    "slotToElicit": "requestedDate"
  },
  "slots": {
    "customerName": {
      "shape": "Scalar",
      "value": {
        "originalValue": "Thuyet",
        "interpretedValue": "Thuyet",
        "resolvedValues": [
          "Thuyet"
        ]
      }
    },
    "customerPhone": {
      "shape": "Scalar",
      "value": {
        "originalValue": "+********7681",
        "interpretedValue": "+********7681",
        "resolvedValues": [
          "+********7681"
        ]
      }
    },
    "serviceName": {
      "shape": "Scalar",
      "value": {
        "originalValue": "Full Set",
        "interpretedValue": "Full Set",
        "resolvedValues": [
          "Full Set"
        ]
      }
    },
    "requestedDate": null
  }
}

### dtmf-date
{
    "StatusCode": 200,
    "FunctionError": null
}
{
  "messages": [
    {
      "contentType": "PlainText",
      "content": "What name should I put the appointment under? Press 0 to speak with an operator."
    }
  ],
  "sessionAttributes": {
    "salonId": "9bd14a12-85ed-418a-af7d-3f5cb329c147",
    "CalledNumber": "+********7681",
    "CustomerEndpointAddress": "+********7681",
    "AmazonConnectContactId": "live-lambda-dtmf-20260708",
    "lastAskedSlot": "customerName",
    "serviceName": "Full Set",
    "confirmedServiceName": "Full Set",
    "customerPhone": "+********7681",
    "requestedDate": "2026-07-09",
    "requestedTime": "3 PM",
    "initialBookingUtterance": "tomorrow at 3 PM",
    "askedSlotsCount": "1",
    "fallbackCount": "1",
    "errorCount": "1"
  },
  "dialogAction": {
    "type": "ElicitSlot",
    "slotToElicit": "customerName"
  },
  "slots": {
    "customerPhone": {
      "shape": "Scalar",
      "value": {
        "originalValue": "+********7681",
        "interpretedValue": "+********7681",
        "resolvedValues": [
          "+********7681"
        ]
      }
    },
    "serviceName": {
      "shape": "Scalar",
      "value": {
        "originalValue": "Full Set",
        "interpretedValue": "Full Set",
        "resolvedValues": [
          "Full Set"
        ]
      }
    },
    "requestedDate": {
      "shape": "Scalar",
      "value": {
        "originalValue": "2026-07-09",
        "interpretedValue": "2026-07-09",
        "resolvedValues": [
          "2026-07-09"
        ]
      }
    },
    "requestedTime": {
      "shape": "Scalar",
      "value": {
        "originalValue": "3 PM",
        "interpretedValue": "3 PM",
        "resolvedValues": [
          "3 PM"
        ]
      }
    },
    "customerName": null
  }
}

## Post-deploy CloudWatch smoke log sweep
Wed Jul  8 18:48:59 UTC 2026

### /aws/lambda/fastaibooking-booking-handler
EVENTS	39774191342495229961796464196455160923594475984913498115	********0655	2026/07/08/[$LATEST]a9377b02470a4904a5515c9ff60ae63a	START RequestId: 42992c48-ee68-47f6-b77a-8abf8995f5a8 Version: $LATEST
	********3936
EVENTS	39774191344502297029664220279193375568132828520451735556	********0655	2026/07/08/[$LATEST]a9377b02470a4904a5515c9ff60ae63a	END RequestId: 42992c48-ee68-47f6-b77a-8abf8995f5a8
	********4026
EVENTS	39774191344502297029664220279193375568132828520451735557	********0655	2026/07/08/[$LATEST]a9377b02470a4904a5515c9ff60ae63a	REPORT RequestId: 42992c48-ee68-47f6-b77a-8abf8995f5a8	Duration: 89.51 ms	Billed Duration: 90 ms	Memory Size: 128 MB	Max Memory Used: 69 MB
	********4026

### /aws/connect/fastaibooking

### /aws/lex/KHMIXGA2US

## Repository wording/search checks
Wed Jul  8 18:49:22 UTC 2026
### Exact unavailable phrase search
### Active call-flow stale Full Set wording search
