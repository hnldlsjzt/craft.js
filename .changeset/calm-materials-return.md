---
'@craftjs/core': patch
---

Add opt-in `allowMissingComponents` support for serialized documents. Unknown
component names render null without mutating the resolver, while retaining their
original names, opaque props, subtrees, and history for later serialization and
restoration. Existing strict node loading remains the default.
