# macOS releases

The `macOS release` workflow builds separate Apple Silicon (`arm64`) and Intel
(`x86_64`) downloads on native macOS runners. It uses Developer ID Application
signing, hardened runtime, secure timestamps and Apple notarization. Each release
contains a DMG, a portable ZIP of the stapled app, and SHA-256 checksums per CPU.
No Windows or Linux releases are built.

## Credentials

Configure the `APPLE_TEAM_ID` repository variable and these Actions secrets:

- `APPLE_CERTIFICATE_P12_BASE64`: base64-encoded Developer ID Application P12, including its private key.
- `APPLE_CERTIFICATE_PASSWORD`: P12 password.
- `APPLE_NOTARY_KEY_P8_BASE64`: base64-encoded App Store Connect Team API private key.
- `APPLE_NOTARY_KEY_ID`: Team API key ID.
- `APPLE_NOTARY_ISSUER_ID`: Team API issuer ID.

These credentials are independent of the app name. Signing fails if credentials
are missing or the imported identity does not match the team. Credentials are
imported only after compilation into a temporary keychain; the original keychain
search list is restored and temporary files are removed in an `always()` step.
Never commit credential files. No signing workflow runs on pull requests.

## Test a signed build

Use **Actions → macOS release → Run workflow** after the workflow is on the
default branch. Pushes to the dedicated `release/macos` branch also build signed
artifacts, which allows initial verification before merging. These runs upload
downloads to Actions and never create a GitHub Release.

Each native runner tests the Rust backend, builds the frontend and app, signs and
notarizes the app, staples it, creates/signs/notarizes/staples the DMG, and finally
creates the ZIP. It then verifies checksums, signatures, signing team, architecture,
hardened runtime, timestamps, notarization tickets and Gatekeeper for both formats.
The downloaded ZIP app and mounted DMG app both run a daemon smoke test exercising
terminal input/output, resize, disconnect/reconnect, scrollback replay and shutdown.

To verify downloaded Actions artifacts locally:

```sh
APPLE_TEAM_ID=YOUR_TEAM_ID python3 scripts/release/verify-artifacts.py /path/to/downloads arm64
APPLE_TEAM_ID=YOUR_TEAM_ID python3 scripts/release/verify-artifacts.py /path/to/downloads x86_64
```

Runtime smoke tests run only for the host's native architecture; signatures and
notarization can be verified for either architecture on the same Mac. The CI jobs
exercise each architecture on its matching runner. Interactive GUI behavior still
needs a manual check before a release.

## Publish

1. Set the same version in `package.json`, `src-tauri/Cargo.toml` and
   `src-tauri/tauri.conf.json`, and update the Cargo lockfile if needed.
2. Commit the version change and push a tag such as `v0.1.0` at the intended commit.
3. Both architecture jobs must pass before the publish job runs. The tag must
   exactly match the app version.

The publish job creates a draft, attaches all six verified files, then makes the
release public. Tags with a prerelease suffix are marked as prereleases. Existing
public releases are never overwritten; failed draft uploads can be rerun.

Notarization timeouts retain the submission ID. Inspect that submission with
`notarytool info` or `notarytool log` before retrying an upload.

References: [Apple notarization](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution),
[GitHub macOS runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners),
[Tauri macOS distribution](https://v2.tauri.app/distribute/macos-application-bundle/).
