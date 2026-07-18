# Repository Instructions

## FastAIBooking AWS Deployment Guard

Profile: `nailnew`
Region: `us-east-1`
Account: `197452633989`
Expected principal: `arn:aws:iam::197452633989:user/fastaibooking-codex-deployer`

Never use profile `default`.
Always run the identity guard before Connect, Lex, Lambda, IAM, Logs, or S3 work.
Fail closed if the identity is different.
