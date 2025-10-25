# Character.AI to OpenAI API Proxy

## Overview
OpenAI-compatible API proxy bridge for Character.AI. Allows using Character.AI through any OpenAI-compatible client with conversation persistence and dialogue continuation.

## Purpose
- Expose Character.AI through OpenAI-compatible API format
- Enable one-click Vercel deployment
- Maintain conversation history locally
- Continue existing dialogues from Character.AI website

## Recent Changes
- 2025-10-25: Complete implementation of Character.AI to OpenAI proxy
  - CAINode integration for Character.AI API
  - OpenAI-compatible /v1/chat/completions endpoint
  - Vercel-compatible storage (local + /tmp for serverless)
  - All tests passing with provided credentials

## Architecture
- **Backend**: Node.js serverless functions (Vercel-compatible)
- **API**: OpenAI-compatible `/v1/chat/completions` endpoint
- **Storage**: Adaptive storage layer (local dev / /tmp for Vercel)
- **Integration**: CAINode library for Character.AI WebSocket API

## Test Credentials
- Character.AI Token: `4dc521360661063088e29f4fcbf46350db470923`
- Test Character ID: `3mMpgx1TwWjQJK9QNaMZMfy1ekaABliiKG6tb2kfRi0`

## Deployment
Configured for one-click Vercel deployment with serverless functions.
