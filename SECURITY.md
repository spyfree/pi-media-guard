# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub Security Advisories for `spyfree/pi-media-guard`. Do not include sensitive images, Base64 payloads, credentials, or complete session files in a public issue.

## Local permissions

Pi extensions execute with the user's full local permissions. Review the package source and pin a release tag or npm version before installation.

## Privacy guarantees

The extension performs media inventory and image compression locally. It does not send telemetry or make secondary model calls. Diagnostics contain aggregate byte counts and actions, not Base64 media, complete provider payloads, credentials, or image contents.

Request Projection is ephemeral and does not modify the persisted Pi session JSONL. Optional semantic vision descriptions are not implemented in the alpha release.
