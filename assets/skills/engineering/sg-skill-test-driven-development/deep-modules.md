# Deep Modules

Source: "A Philosophy of Software Design"

**Deep module** = small interface + large implementation

```
┌─────────────────────┐
│   Small interface   │  ← few methods, simple parameters
├─────────────────────┤
│                     │
│                     │
│  Deep implementation│  ← complex logic hidden
│                     │
│                     │
└─────────────────────┘
```

**Shallow module** = large interface + small implementation (avoid)

```
┌─────────────────────────────────┐
│       Large interface           │  ← many methods, complex parameters
├─────────────────────────────────┤
│  Thin implementation            │  ← just passes through
└─────────────────────────────────┘
```

Ask when designing an interface:
- Can we reduce the number of methods?
- Can we simplify the parameters?
- Can we hide more complexity?
