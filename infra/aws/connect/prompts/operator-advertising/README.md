# FastAIBooking Anh Kiet advertising operator prompts

These fixed prompts support Anh Kiet's dedicated operator-only advertising
hotline. The hotline is English-only, does not present a keypad menu, and does
not invoke Lex or any conversational AI.

## Call behavior

- Voice: Amazon Polly Joanna, Neural engine, Conversational style.
- Speaking rate: SSML prosody at `90%` of the selected voice's normal rate.
- Connecting: `Please hold while we connect your call to an operator.`
- Busy: `All of our operators are currently assisting other callers. Please call again later, or leave a message after the beep.`
- Completion: `Thank you. Your message has been recorded. Goodbye.`

Every synthesized English message uses the same voice and speaking rate in the
main and customer queue flows. The voicemail window is a 60-second silent
prompt played after a 1 kHz beep while automated-interaction recording is
enabled.
