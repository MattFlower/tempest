# Release Build Guide

How to build a signed, notarized Tempest.app for distribution to other Macs.

## One-Time Setup (per machine)

### 1. Generate an app-specific password

1. Go to https://appleid.apple.com
2. Sign in > **Sign-In and Security** > **App-Specific Passwords**
3. Click **+** to generate a new one (name it "Tempest notarytool" or similar)
4. Copy the generated password (format: `xxxx-xxxx-xxxx-xxxx`)

### 2. Store credentials in the macOS keychain

```bash
xcrun notarytool store-credentials "Tempest" \
  --apple-id YOUR_APPLE_ID_EMAIL \
  --team-id 24P9P34MKT
```

When prompted, paste the app-specific password from step 1.

This saves everything in the macOS keychain under the profile name "Tempest". No passwords are stored in project files.

### 3. Verify you have a Developer ID certificate

```bash
security find-identity -v -p codesigning | grep "Developer ID Application"
```

You should see something like:
```
"Developer ID Application: Matthew Flower (24P9P34MKT)"
```

If not, open Xcode > Settings > Accounts > Manage Certificates and create a "Developer ID Application" certificate.

## Building a Release

```bash
./scripts/release.sh
```

This will:
1. Build the app with Electrobun (`bun run build:release`)
2. Code-sign with the Developer ID certificate
3. Submit to Apple for notarization (takes 1-2 minutes)
4. Staple the notarization ticket to the app
5. Produce `Tempest.zip` at the project root

Send that zip to another Mac -- it should open without Gatekeeper warnings.

## Troubleshooting

**401 from notarytool**: You're using your Apple ID password instead of an app-specific password. Generate one at appleid.apple.com (see step 1 above).

**"No Developer ID certificate"**: Open Xcode > Settings > Accounts, select your team, click Manage Certificates, and create a "Developer ID Application" certificate.

**Notarization rejected**: Run `xcrun notarytool log <submission-id> --keychain-profile "Tempest"` to see the detailed rejection reasons.

**Gatekeeper still warns on the target Mac**: Verify stapling worked with `xcrun stapler validate Tempest.app`. Also check signing with `spctl --assess --verbose Tempest.app`.
