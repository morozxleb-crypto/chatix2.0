# Character.AI to OpenAI API Proxy

## Overview
OpenAI-compatible API proxy bridge for Character.AI. Allows using Character.AI through any OpenAI-compatible client with conversation persistence and dialogue continuation.

## Purpose
- Expose Character.AI through OpenAI-compatible API format
- Enable one-click Vercel deployment
- Maintain conversation history locally
- Continue existing dialogues from Character.AI website

## Recent Changes
- 2025-10-25: Initial project setup with Node.js and Vercel configuration

## Architecture
- **Backend**: Node.js serverless functions for Vercel
- **API**: OpenAI-compatible `/v1/chat/completions` endpoint
- **Storage**: Local JSON files for conversation persistence
- **Integration**: Character.AI unofficial API client

## Test Credentials
- Character.AI Token: `4dc521360661063088e29f4fcbf46350db470923`
- Test Character ID: `3mMpgx1TwWjQJK9QNaMZMfy1ekaABliiKG6tb2kfRi0`

## Deployment
Configured for one-click Vercel deployment with serverless functions.
