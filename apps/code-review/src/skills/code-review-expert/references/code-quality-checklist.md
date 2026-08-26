# Code Quality Checklist

## Complexity and Maintainability
- Functions over ~50 lines, cyclomatic complexity > 10, or nesting deeper than 4 levels
- Duplicated logic, unclear naming, commented-out code
- Tight coupling, poor testability, or unclear separation of concerns

## Error Handling

### Anti-patterns to Flag
- **Swallowed exceptions**: Empty catch blocks or catch with only logging
- **Overly broad catch**: Catching base `Error` instead of specific types
- **Error information leakage**: Stack traces or internal details exposed to users
- **Missing error handling**: No try-catch around fallible operations (I/O, network, parsing)
- **Async error handling**: Unhandled promise rejections, missing `.catch()`, no error boundary

### Best Practices
- Errors are caught at appropriate boundaries
- Error messages are user-friendly (no internal details exposed)
- Errors are logged with sufficient context for debugging
- Async errors are properly propagated or handled
- Fallback behavior is defined for recoverable errors

## Performance & Caching

### CPU-Intensive Operations
- Expensive operations in hot paths: Regex compilation, JSON parsing, crypto in loops
- Blocking main thread: Sync I/O, heavy computation without worker/async
- Unnecessary recomputation: Same calculation done multiple times
- Inefficient algorithms: O(n^2) scans or nested loops where a map/set/index would make it O(n)
- Unnecessary React/Vue re-renders from unstable props, callbacks, or dependency arrays

### Database & I/O
- **N+1 queries**: Loop that makes a query per item instead of batch
- **Missing indexes**: Queries on unindexed columns
- **Over-fetching**: SELECT * when only few columns needed
- **No pagination**: Loading entire dataset into memory

### Caching Issues
- Missing cache for expensive operations
- Cache without TTL: Stale data served indefinitely
- Cache without invalidation strategy

### Memory
- Unbounded collections: Arrays/maps that grow without limit
- Large object retention: Holding references preventing GC
- Loading large files entirely: Use streaming instead

## Boundary Conditions

### Null/Undefined Handling
- Missing null checks: Accessing properties on potentially null objects
- Truthy/falsy confusion: `if (value)` when `0` or `""` are valid
- Optional chaining overuse: `a?.b?.c?.d` hiding structural issues

### Empty Collections
- Empty array not handled: Code assumes array has items
- First/last element access without length check

### Numeric Boundaries
- Division by zero: Missing check before division
- Integer overflow: Large numbers exceeding safe range
- Floating point comparison: Using `===` instead of epsilon
- Off-by-one errors: Loop bounds, array slicing, pagination

### Questions to Ask
- "What if this is null/undefined?"
- "What if this collection is empty?"
- "What happens at the boundaries (0, -1, MAX_INT)?"

## Best Practices
- Inappropriate log levels or sensitive data in logs
- Missing tests for critical paths
