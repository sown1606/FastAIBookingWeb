# FastAIBooking Anh Kiet advertising operator prompts

These fixed prompts support Anh Kiet's dedicated operator-only advertising
hotline. The hotline is English-only, does not present a keypad menu, and does
not invoke Lex or any conversational AI.

## Call behavior

- Connecting: `Please hold while we connect your call to an operator.`
- Busy: `All of our operators are currently assisting other callers. Please call again later, or leave a message after the beep.`
- Completion: `Thank you. Your message has been recorded. Goodbye.`

The checked-in flow uses Amazon Polly voice Joanna for the English messages.
The voicemail window is a 60-second silent prompt played after a 1 kHz beep
while automated-interaction recording is enabled.
