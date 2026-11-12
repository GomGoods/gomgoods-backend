# Phase 6 — Mock Payment, VietQR, SePay Test Mode

## Webhook để cấu hình SePay

```text
POST https://<ngrok-domain>/api/payments/webhooks/sepay
Content-Type: application/json
```

Endpoint không dùng JWT người dùng. Nó dùng **HMAC-SHA256** mặc định:

```text
X-SePay-Timestamp: <Unix seconds>
X-SePay-Signature: sha256=<hex HMAC-SHA256(secret, timestamp + "." + raw_body)>
```

Timestamp phải trong ±300 giây. Chữ ký được so sánh constant-time trên bytes gốc,
không serialize lại JSON. Nếu chọn `SEPAY_WEBHOOK_AUTH=api_key`, cấu hình SePay gửi
`Authorization: Apikey <test-webhook-secret>` thay cho HMAC. Không có chế độ bỏ xác thực.
Secret webhook và token API sandbox là hai credential khác nhau.

Webhook đã xác thực và payload hợp lệ trả **HTTP 200, chính xác `{"success":true}`**
sau khi transaction DB đã commit. Sai auth trả 401; payload sai trả 422; cùng ID hoặc
bank reference nhưng dữ liệu thanh toán khác trả 409; DB/config tạm lỗi không ACK thành công.
SePay có thể retry/replay; không được tắt kiểm tra trùng.

Giao dịch hợp lệ về cấu trúc nhưng sai amount/destination/reference, chuyển ra,
đến muộn hoặc order không còn pending vẫn được ghi audit và ACK 200. ACK chỉ xác nhận
đã ghi nhận event, **không có nghĩa payment đã PAID**. Xem `status`/`reason` trong audit admin.

## Chỉ dùng dữ liệu và tài khoản giả lập

- Mặc định `PAYMENT_MODE=disabled`; chỉ hỗ trợ `disabled`, `mock`, `sepay_test`.
- Hai mode thử nghiệm bị chặn khi `NODE_ENV=production` hoặc DB đang chọn không có
  `test` trong tên. Dùng `NODE_ENV=test` để app chọn `TEST_DATABASE_URL` theo cơ chế sẵn có.
- Không sửa `.env`/`.env.test` để thử. Đặt biến môi trường trong terminal riêng.
- Bật **Test Mode** trong SePay và tạo **tài khoản ngân hàng giả mới**, webhook và API
  Access riêng trong Test Mode. Không dùng credential Live hoặc sao chép tài khoản nhận tiền thật.
- VietQR chỉ cung cấp ảnh/instructions thử nghiệm. **Không quét để chuyển tiền trong app ngân hàng.**
  Tạo giao dịch bằng chức năng **Mô phỏng giao dịch** trong SePay Test Mode.
- Không có API chuyển tiền, hoàn tiền, hoặc fallback tới Live trong implementation này.

## Cấu hình local

Các biến hiện có cho auth/database vẫn cần được cấu hình theo repository.
Không in hoặc gửi credential lên chat, Git, ngrok screenshots hay tài liệu.

| Biến                         | Giá trị / ý nghĩa                                                            |
| ---------------------------- | ---------------------------------------------------------------------------- |
| `NODE_ENV`                   | `test`                                                                       |
| `PAYMENT_MODE`               | `sepay_test`, hoặc `mock` để xác nhận giả lập nội bộ                         |
| `PORT`                       | Ví dụ `3000`                                                                 |
| `TEST_DATABASE_URL`          | DB test đã xác minh, trong môi trường này là `localhost:55432/gomgoods_test` |
| `SEPAY_WEBHOOK_AUTH`         | `hmac` (mặc định), hoặc `api_key`                                            |
| `SEPAY_TEST_WEBHOOK_SECRET`  | Secret chỉ của webhook Test Mode, tối thiểu 32 ký tự                         |
| `SEPAY_TEST_ACCOUNT_NUMBER`  | Số tài khoản giả trong Test Mode; 1–19 ký tự chữ/số                          |
| `SEPAY_TEST_BANK_NAME`       | Tên đúng như `gateway` / `bank_brand_name` SePay gửi, ví dụ `Vietcombank`    |
| `SEPAY_TEST_VA`              | Tùy chọn: đúng một VA chính thức Test Mode `SBSEPAY` + 12 ký tự A-Z/0-9 đã xác minh thuộc tài khoản gốc; không tự lấy từ webhook |
| `VIETQR_TEST_BANK_BIN`       | BIN ngân hàng gồm 6 chữ số, ví dụ `970436` cho Vietcombank                   |
| `VIETQR_TEST_ACCOUNT_NAME`   | Tên hiển thị giả; ASCII, tối đa 80 ký tự                                     |
| `SEPAY_TEST_API_TOKEN`       | Chỉ cần khi đối soát; API Access tạo trong Test Mode                         |
| `SEPAY_TEST_BANK_ACCOUNT_ID` | Chỉ cần khi đối soát; UUID tài khoản ngân hàng Test Mode trong API v2        |

Không đổi `DATABASE_URL` thành DB dev để chạy test payment. Khi `NODE_ENV=test`,
repository giữ application URL để kiểm tra khác target và dùng `TEST_DATABASE_URL` cho app.
Không chạy `npm run db:migrate:deploy` bằng cấu hình mặc định hướng vào dev DB.
Migration mới `20261016000000_add_payment_events` phải được áp dụng bằng một process
đã xác minh target và chỉ có `DATABASE_URL` trỏ tới DB test. Không sửa migration cũ/reset DB.

Ví dụ PowerShell, sau khi tự đặt các biến test/secret trong terminal:

```powershell
$env:NODE_ENV = 'test'
$env:PAYMENT_MODE = 'sepay_test'
$env:PORT = '3000'
$env:SEPAY_WEBHOOK_AUTH = 'hmac'
# Đặt các biến SEPAY_TEST_* và VIETQR_TEST_* ở bảng trên bằng dữ liệu Test Mode.
npm run start:dev
```

Đối với mock local, đặt `PAYMENT_MODE=mock`; không cần credential SePay/VietQR.
Giữ terminal riêng để không vô tình mang cấu hình test sang process khác.

## Lấy HTTPS URL bằng ngrok

1. Cài ngrok từ trang chính thức: <https://ngrok.com/downloads/windows> và đăng nhập
   tài khoản ngrok. Thiết lập authtoken theo hướng dẫn dashboard trên máy của bạn;
   không đưa authtoken vào source code hay báo cáo.
2. Chạy backend test trên port đã chọn. Xác nhận `http://localhost:3000/api/health`
   hoạt động (thay port nếu dùng port khác).
3. Mở terminal thứ hai:

   ```powershell
   ngrok http http://localhost:3000 --inspect=false
   ```

4. Lấy giá trị **Forwarding** có HTTPS, ví dụ `https://example.ngrok-free.app`.
   URL webhook cần nhập vào SePay là:

   ```text
   https://example.ngrok-free.app/api/payments/webhooks/sepay
   ```

5. Trong **SePay Test Mode → Webhooks → Thêm webhook**:
   - Sự kiện: **Có tiền vào**.
   - Tài khoản: tài khoản giả đã chọn ở cấu hình backend.
   - URL: HTTPS URL ở trên; body: JSON.
   - Bảo mật: **HMAC-SHA256**, dùng đúng secret test đã đặt ở backend.
     Nếu backend dùng `api_key`, chọn API Key và dùng cùng key test.
   - Cấu hình mã thanh toán Test Mode: tiền tố **GGT**, hậu tố đúng **25 ký tự**,
     loại **Số và chữ**. Mã giữ đầy đủ entropy UUID, không cắt ngắn.
6. Ngrok URL miễn phí có thể đổi khi restart; cập nhật URL trong webhook khi cần.
   `--inspect=false` tránh lưu body/header payment trong inspector local.
7. Không cần gửi tiền. Tạo bank-transfer checkout trong backend test, lấy VietQR
   instructions, rồi dùng **Mô phỏng giao dịch** trên SePay với đúng amount/reference.

Agent không tự mở tunnel, không tạo tài khoản/secret và không đăng nhập dashboard thay bạn.

## API sử dụng

Các API dưới đây dùng response envelope chuẩn `{success:true,data:...}`, ngoại trừ
webhook phải dùng acknowledgement riêng như trên.

| Endpoint                                                         | Quyền               | Hành vi                                                                        |
| ---------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------ |
| `GET /api/payments/:id`                                          | Buyer sở hữu order  | Trạng thái payment; không trả payload event hoặc credential                    |
| `GET /api/payments/:id/vietqr`                                   | Buyer; `sepay_test` | Amount từ DB, reference, expiry và VietQR SVG Quick Link cho tài khoản giả     |
| `POST /api/payments/:id/mock-confirm`                            | Buyer; `mock`       | Body `{"idempotencyKey":"test-attempt-1"}`; không nhận amount/status từ client |
| `POST /api/payments/webhooks/sepay`                              | HMAC/API Key test   | Xác minh và xử lý event từ SePay Test Mode                                     |
| `GET /api/admin/payments/events?status=REJECTED&page=1&limit=20` | ADMIN               | Audit phân trang, gồm giao dịch chưa khớp, bị từ chối/bỏ qua                   |
| `POST /api/admin/payments/reconcile/sepay-test`                  | ADMIN; `sepay_test` | Fetch một page từ API sandbox để khôi phục webhook bị mất                      |

VietQR yêu cầu positive whole VND. Backend trả 422 cho amount có phần lẻ, không làm
tròn số tiền. COD không được xác nhận bằng bank-transfer/mock flow này.
Multi-seller checkout tạo payment riêng theo seller order: mỗi payment có reference
và amount riêng, không xác nhận toàn bộ checkout group bằng một lần chuyển khoản.

## Verification, idempotency và stock

- Destination account + gateway phải khớp tài khoản **gốc** trong cấu hình Test Mode,
  direction phải `in`. Nếu không đặt `SEPAY_TEST_VA`, `subAccount` khác rỗng vẫn bị
  bỏ qua với `UNSUPPORTED_SUB_ACCOUNT` như trước.
- Opt-in VA chỉ cho **một VA chính thức** `SBSEPAY` + 12 ký tự A-Z/0-9. Khi đã đặt
  `SEPAY_TEST_VA`, webhook và reconciliation phải có `subAccount` khớp chính xác
  (sau trim); thiếu/sai VA ghi `IGNORED / SUB_ACCOUNT_MISMATCH`, không credit.
  Không chấp nhận mọi VA, không học VA từ payload và chưa hỗ trợ TKP 3 ký tự.
- Với opt-in VA, VietQR instructions dùng số VA làm tài khoản thụ hưởng trong
  `accountNumber`/QR URL. `SEPAY_TEST_ACCOUNT_NUMBER` vẫn là tài khoản gốc để kiểm
  tra callback, không thay nó bằng VA. VA không thay thế mã GGT, amount hay expiry.
- Bóc đúng một reference `GGT...` nguyên vẹn từ content. Nếu `code` được gửi, nó phải
  khớp cùng reference; không chấp nhận nhiều reference hoặc đoán theo substring.
- Amount phải đúng `Payment.amount` và `Order.total`. Transaction date giờ Việt Nam
  được kiểm tra calendar; không chấp nhận event trước lúc tạo payment hoặc quá xa trong tương lai.
- Xác nhận chỉ khi order/payment còn `PENDING`, chưa hủy và chưa hết hạn **tại lúc xử lý**.
  Payment đến sau expiry/hủy chỉ vào audit; không hồi sinh order hay trừ stock lần hai.
- Dùng cùng `lockOrderForMutation` của Phase 5: khóa ORDER → PAYMENT, rồi CAS trạng thái.
  Payment `PAID`, order `CONFIRMED`, transaction `SUCCEEDED` và event `APPLIED` commit cùng nhau.
- Unique event identity theo provider/ID; unique bank reference theo provider/account/gateway
  để gộp webhook ID dạng số và API v2 ID dạng UUID. Fingerprint các trường thanh toán ổn định
  ngăn cùng identity bị tái sử dụng cho amount/reference khác. Bank reference trống không được
  coi là một identity dùng chung cho tất cả giao dịch.
- ID transport thứ hai cho cùng bank reference vẫn được lưu thành audit alias `IGNORED`
  với reason `DUPLICATE_PROVIDER_IDENTITY`; kết quả trả về là event gốc. Alias giữ khóa unique
  provider/ID, không mang bank reference unique lần hai và không tạo transaction thanh toán.
- Fingerprint vẫn bao gồm `subAccount` và không phụ thuộc cấu hình VA. Bật VA sau
  này không tự xử lý lại event cũ đã `IGNORED`; replay giữ kết quả audit cũ. Demo
  mới cần reference/payment mới và giao dịch mô phỏng mới do operator gửi từ SePay.
- Cùng event trả lại kết quả đã ghi nhận. Event khác đến payment đã trả tiền được ghi
  `REJECTED`; không tạo successful transaction thứ hai.
- Không tự ghép thiếu/thừa tiền, tự đổi order, tự force-confirm hoặc tự hoàn tiền.

## Đối soát

```json
{
  "from": "2026-10-16T00:00:00+07:00",
  "to": "2026-10-16T23:59:59+07:00",
  "page": 1
}
```

Khoảng thời gian phải có thứ tự, tối đa 24 giờ. Mỗi request lấy tối đa 100 events,
chỉ từ **`https://userapi-sandbox.sepay.vn/v2/transactions`**, với token Test Mode và
bank-account UUID đã cấu hình. Không nhận URL hoặc dữ liệu chuyển tiền từ caller để
tự xác nhận; redirect, timeout, lỗi provider và dữ liệu không hợp lệ đều fail closed.

Response có `hasMore`/`nextPage`. Gọi tiếp page kế, giữ nguyên khoảng thời gian khi
`hasMore=true`; giới hạn tần suất theo SePay (tối đa 3 requests/giây). Chạy lại cùng
page an toàn, kể cả nếu lần trước mất kết nối sau khi một số events đã commit.
Không có scheduler tự động: operator/CI gọi endpoint này hoặc cấu hình cron riêng.

Đối soát dùng cùng pipeline với webhook và không vượt qua expiry/cancellation guards.
Event `REJECTED`/`IGNORED` giữ nguyên audit; không có endpoint sửa payload để force payment.
Xem `reason` và nhật ký SePay Test Mode để xử lý tình huống không khớp bằng dữ liệu thử mới.

Nếu upstream không có bank reference, webhook ID số và API UUID không thể chứng minh
là cùng một bank event. Khi đó có thể có hai audit rows; order/payment CAS vẫn chỉ cho
phép một successful payment. Không suy đoán identity dựa vào amount/reference order.

## Kiểm thử và phạm vi xác minh

- Unit tests: HMAC raw bytes, timestamp/replay, API Key, disabled/production/DB gates,
  reference UUID đầy đủ, calendar và canonical fingerprint.
- PostgreSQL E2E: webhook thật qua HTTP, auth/privacy, duplicate/concurrent events,
  conflicting identities, amount/destination/reference, rollback, cancel/expire races,
  mock mode, VietQR và reconciliation.
- E2E reconciliation thay HTTP tới SePay bằng fixtures có kiểm tra hợp đồng; DB và
  transaction logic chạy thật trên DB test. Không cần tiền/token thật để chạy suite.
- Kết nối SePay Dashboard/ngrok end-to-end chỉ được xác minh sau khi bạn tự cấu hình
  credential/tunnel và gửi giao dịch **mô phỏng**. Không coi test nội bộ là đã xác minh provider thật.
- Regression VA: exact opt-in, missing/different VA, tài khoản/gateway sai, amount
  sai, thiếu GGT, direction, cancel/expiry, QR dùng VA, replay exactly-once và
  không hồi sinh audit cũ. Không cần đổi schema/migration để áp dụng rule này.

## Nguồn chính thức đã đối chiếu

- HMAC/API Key: <https://developer.sepay.vn/vi/sepay-webhooks/xac-thuc>
- Payload, ACK, retry: <https://developer.sepay.vn/vi/sepay-webhooks/tich-hop-webhook>
- Test Mode: <https://developer.sepay.vn/vi/tien-ich-khac/test-mode>
- API Access sandbox: <https://developer.sepay.vn/vi/tien-ich-khac/test-mode/api-access>
- API v2 transactions: <https://developer.sepay.vn/vi/sepay-api/v2/giao-dich/danh-sach>
- Đối soát: <https://developer.sepay.vn/vi/sepay-webhooks/doi-soat-giao-dich>
- Payment reference config: <https://developer.sepay.vn/vi/sepay-webhooks/cau-hinh-ma-thanh-toan>
- VietQR Quick Link (SVG): <https://www.vietqr.io/qr-dong>
