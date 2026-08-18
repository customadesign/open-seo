# Report delivery

OpenSEO can turn a stored report snapshot into a branded PDF, keep the PDF in the deployment's R2 bucket, and email it to schedule recipients. Expiring share links open a client-readable HTML report in the browser. A caller that sends `Accept: application/json` to a share link can still retrieve the snapshot and artifact metadata.

The app uses [Gotenberg's HTML conversion endpoint](https://gotenberg.dev/docs/convert-with-chromium/convert-html-to-pdf) for PDFs and [Resend's email API](https://resend.com/docs/api-reference/emails/send-email) for delivery. OpenSEO sends the report HTML as `index.html`, asks Gotenberg to print CSS backgrounds, stores the returned PDF in R2, and attaches the stored file to the email.

## Configuration

| Variable                         | Required for | Value                                                                                  |
| -------------------------------- | ------------ | -------------------------------------------------------------------------------------- |
| `REPORT_PDF_RENDER_URL`          | PDF          | Base URL of an access-controlled Gotenberg service                                     |
| `REPORT_PDF_RENDER_BEARER_TOKEN` | PDF          | Optional token sent to the renderer proxy as `Authorization: Bearer ...`               |
| `RESEND_API_KEY`                 | Email        | Resend API key                                                                         |
| `REPORT_EMAIL_FROM`              | Email        | Sender on a domain verified by Resend, such as `OpenSEO Reports <reports@example.com>` |
| `REPORT_EMAIL_REPLY_TO`          | Email        | Optional reply address                                                                 |

Set the values in `.env.local` for local development, `.env` for Docker, `.env.selfhost` for a Cloudflare self-host, or `.env.production` for the hosted deployment. Restart or redeploy after changing them.

Gotenberg has no built-in authentication and its maintainers advise against exposing it to the public internet. Put it behind a reverse proxy, service gateway, or tunnel that requires the bearer token. Do not set `REPORT_PDF_RENDER_URL` to an unprotected Gotenberg instance. Cloudflare Workers cannot call a private RFC 1918 address with this repository's strict public-fetch setting, so Cloudflare deployments need an access-controlled HTTPS endpoint.

## Runtime behavior

- A manual run creates a snapshot and shareable HTML report. It also creates a PDF when the renderer is configured.
- A weekly or monthly schedule sends one email to each saved recipient. The Reports page currently creates monthly schedules with one recipient at a time; the schema supports up to 100.
- Each PDF uses the stable key `reports/<run-id>/report.pdf`. Retries replace that run's artifact instead of creating copies.
- Email requests use a stable idempotency key. Resend retains idempotency keys for 24 hours, as described in its [idempotency guide](https://resend.com/docs/dashboard/emails/idempotency-keys).
- OpenSEO rejects renderer responses that are not PDFs and caps PDF files at 25 MB before storage or attachment.
- Report failures appear in Recent runs and the project Changes feed. A successful retry adds a recovery event.

The first PDF version uses the saved brand name and colors. It does not ask the renderer to fetch the saved logo URL because that would let project data direct the renderer to arbitrary network addresses.

## Check the setup

1. Open a project and go to Reports.
2. Confirm the provider notice is gone.
3. Create a starter template and generate a 28-day snapshot.
4. Open the copied share link in a private browser window.
5. Enter a delivery email, create a monthly schedule, and run the schedule in a test environment before using a client address.

Never use a production client address for the first provider test. The provider unit tests use mocked network requests and do not send email.
