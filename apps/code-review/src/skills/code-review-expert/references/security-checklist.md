# Security and Reliability Checklist

## Input/Output Safety
- **XSS**: Unsafe HTML injection, `dangerouslySetInnerHTML`, unescaped templates, innerHTML assignments
- **Injection**: SQL/NoSQL/command/GraphQL injection via string concatenation, template literals, or unsafely composed query objects
- **SSRF**: User-controlled URLs reaching internal services without allowlist validation
- **Path traversal**: User input in file paths without sanitization (`../` attacks)
- **Prototype pollution**: Unsafe object merging in JavaScript (`Object.assign`, spread with user input)
- **CSRF**: State-changing routes protected only by cookies/session auth without CSRF tokens, SameSite posture, or origin checks

## AuthN/AuthZ
- Missing tenant or ownership checks for read/write operations
- New endpoints without auth guards or RBAC enforcement
- Trusting client-provided roles/flags/IDs
- Broken access control (IDOR)
- Session fixation or weak session management
- State-changing operations that do not verify the acting principal can modify the target resource

## Secrets and PII
- API keys, tokens, or credentials in code/config/logs
- Secrets in git history or environment variables exposed to client
- Excessive logging of PII or sensitive payloads
- Missing data masking in error messages

## Race Conditions
- **Shared State Access**: Multiple threads/async tasks accessing shared variables without synchronization
- **Check-Then-Act (TOCTOU)**: `if (exists) then use` patterns without atomic operations
- **Database Concurrency**: Missing optimistic/pessimistic locking, read-modify-write without transactions
- **Distributed Systems**: Missing distributed locks, cache invalidation races

### Questions to Ask
- "What happens if two requests hit this code simultaneously?"
- "Is this operation atomic or can it be interrupted?"

## Runtime Risks
- Unbounded loops, recursive calls, or large in-memory buffers
- Missing timeouts, retries, or rate limiting on external calls
- Blocking operations on request path
- Resource exhaustion (file handles, connections, memory)

## Data Integrity
- Missing transactions, partial writes, or inconsistent state updates
- Weak validation before persistence
- Missing idempotency for retryable operations
- Lost updates due to concurrent modifications
