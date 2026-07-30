# FastAIBooking advertising operator prompts

These fixed prompts support the operator-only advertising hotline. The hotline
does not invoke Lex or any conversational AI.

## Keypad menu

- English: `Thank you for calling Fast A I Booking. For English, press 1.`
- Vietnamese: `Cảm ơn quý khách đã gọi đến Fast A I Booking. Để chọn tiếng Việt, vui lòng nhấn phím 2.`

## Invalid selection

- English: `We did not receive a valid selection. Please call again. Goodbye.`
- Vietnamese: `Hệ thống chưa nhận được lựa chọn hợp lệ. Quý khách vui lòng gọi lại. Xin chào.`

## Vietnamese operator messages

- Connecting: `Xin vui lòng chờ trong giây lát. Chúng tôi đang kết nối cuộc gọi của quý khách tới tổng đài viên.`
- Busy: `Hiện tại tất cả tổng đài viên đều đang bận. Quý khách vui lòng gọi lại sau, hoặc để lại lời nhắn sau tiếng bíp.`
- Completion: `Cảm ơn quý khách. Lời nhắn của quý khách đã được ghi nhận. Xin chào.`

The checked-in flow references Amazon Connect prompt resources created from
8 kHz, mono, G.711 U-Law WAV files. The voicemail window is a 60-second silent
prompt played after a 1 kHz beep while automated-interaction recording is
enabled.
