# Security

Please use GitHub private vulnerability reporting for this repository. If it is unavailable, contact the repository maintainer privately instead of opening a public issue.

Never commit bot credentials, model API keys, CLI tokens, private prompts, internal URLs, or private workspace paths. Use `.env` and `.private/`, both of which are ignored by Git. Rotate a credential immediately if it ever enters Git history; deleting it in a later commit is not sufficient.
