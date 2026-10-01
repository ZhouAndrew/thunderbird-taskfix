# Maintainer Note

This file records the standing delivery conventions for Thunderbird TaskFix.

## Local working directory

Preferred local source directory:

`/home/andrew/Documents/AppData/chatGPT/thunderbird-taskfix`

Use this path by default in future local commands instead of `~/Desktop/thunderbird-taskfix`.

## Release responsibility

Publishing a GitHub Release is part of the normal delivery workflow and can be completed through the repository's GitHub Actions flow. Do not treat the absence of a direct `create_release` connector action as meaning a release cannot be published.

Normal stable-release flow:

`development -> PR -> automated checks -> real Thunderbird GUI acceptance -> merge to main -> GitHub Actions -> stable GitHub Release + XPI`

The maintainer/assistant should carry this through autonomously when repository access and permissions are available, instead of handing routine release steps back to the user.

## Stable-release guarantees

- When a version is genuinely stable, publish a stable Release.
- A stable version is not considered fully delivered until its installable `.xpi` is available from GitHub Releases.
- Keep released stable versions available so users can reinstall or roll back.
- RC/pre-release builds do not replace the stable release.
- Do not publish Stable if required automated checks or real Thunderbird GUI acceptance fail.
- Release Notes are user-facing: summarize features, fixes, compatibility, and installation.
- Detailed GUI acceptance procedures are internal maintainer/testing notes.

## Workflow hygiene

PR and development-branch validation should not create unnecessary GitHub Releases. Prefer test artifacts for non-stable builds, and keep the Releases page focused on meaningful releases.

For local Git/GitHub maintenance commands, prefer a single safe, state-checking, copy-and-paste command block whenever practical.

## Current baseline

Thunderbird TaskFix v0.3.3 is the current stable baseline and has an installable XPI published in GitHub Releases.
