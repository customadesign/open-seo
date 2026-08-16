# Self-hosted Google Ads

OpenSEO can connect one Google Ads serving account to each project and include its results in monthly reports. The integration only reads reporting data.

## What you need

- A Google login with access to the Google Ads account or its manager account.
- A Google Cloud OAuth web application.
- An approved Google Ads API developer token.
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `BETTER_AUTH_SECRET`, and `GOOGLE_ADS_DEVELOPER_TOKEN` set on the OpenSEO deployment.

If Search Console or Google Analytics is already connected, reuse the same Google Cloud project and OAuth client. Google Ads uses a separate consent grant so disconnecting it does not remove the other Google integrations.

## 1. Enable the Google Ads API

Enable the [Google Ads API](https://console.cloud.google.com/apis/library/googleads.googleapis.com) in the Google Cloud project used by the OAuth client.

## 2. Obtain a developer token

Open the API Center in a Google Ads manager account and apply for a developer token. Google controls the access level. A test-level token only works with test accounts.

Store the token as `GOOGLE_ADS_DEVELOPER_TOKEN`. Do not put it in client code or commit it to the repository.

## 3. Register the callback URL

Add an authorized redirect URI to the OAuth web application. It must match the OpenSEO origin followed by `/api/google-ads/oauth/callback`.

| Deployment   | Redirect URI                                                    |
| ------------ | --------------------------------------------------------------- |
| Deployed     | `https://your-openseo-domain.com/api/google-ads/oauth/callback` |
| Local Docker | `http://localhost:3001/api/google-ads/oauth/callback`           |

Keep the Search Console and Analytics callback URLs if those integrations share the OAuth client.

## 4. Set the environment variables

```sh
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
BETTER_AUTH_SECRET=your-random-secret-of-at-least-32-characters
GOOGLE_ADS_DEVELOPER_TOKEN=your-developer-token
```

Restart or redeploy OpenSEO after changing the values.

## 5. Connect a serving account

Open **Project settings → Advertising**, connect with Google, then select the serving account for the project. Manager accounts are used to discover child accounts but cannot be selected as the reporting account.

OpenSEO stores OAuth tokens encrypted in Better Auth's account table. The project connection stores the selected customer ID, currency, timezone, and manager login customer ID.

## Troubleshooting

**No accounts appear**: confirm the connected Google login can access the account and the developer token has the required access level.

**Permission denied**: confirm the developer token belongs to the manager hierarchy used by the connected account. If a manager account is involved, OpenSEO sends its customer ID in the `login-customer-id` header.

**Connection expired**: reconnect with Google. OAuth apps in Testing can receive short-lived refresh grants.

The integration uses the [Google Ads API REST interface](https://developers.google.com/google-ads/api/rest/auth) and Google Ads Query Language for read-only reporting.
