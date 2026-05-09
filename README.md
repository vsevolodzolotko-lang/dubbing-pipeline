# Dubbing Pipeline

Automated localization pipeline for wellness video courses. Takes original audio/script in English and produces dubbed audio tracks in 7 target languages: **DE, ES, FR, IT, PL, PT, TR**.

## What it does

The pipeline accepts a source transcript, runs it through Claude API for tone analysis and translation, synthesizes speech via ElevenLabs TTS for each target language, then generates a Reaper RPP project file with all dubbed tracks pre-aligned to the original video timeline. A ReaScript hotkey workflow handles final timing tweaks inside Reaper without manual track management.

## Stack

- **n8n** — workflow orchestration (batch trigger, error handling, retry logic)
- **Claude API (Anthropic)** — tone analysis, translation, cultural adaptation
- **ElevenLabs TTS API** — multilingual voice synthesis
- **Reaper + ReaScript** — DAW project generation and hotkey-driven audio alignment
- **Google Sheets** — translation tracking, voice mapping, status dashboard
- **Node.js scripts** — API calibration utilities and integration tests

## Status

> **In development.** Week 1 (batch pipeline spike) is in progress. No production-ready workflows yet — see [PLAN.md](./PLAN.md) for the roadmap and [DECISIONS.md](./DECISIONS.md) for architecture decisions log.
