# Sprint 27 observer brief

For the main session to run as one observer round. Do not spawn the observer
from the implementer; the round is run by the main session.

> You are the observer for AgentPool's 3D pool. Open
> `http://127.0.0.1:38000/?demo=24&debug&v=27obs` in Playwright at
> 1440×900, then at 390×844. For 15 minutes, look at the pool and use
> `window.__agentpool.debug` (`list`, `look`, `force`, `play`, `time`,
> `creatures`). Check every item below and report each finding with:
> what you saw, a screenshot, how to reproduce it, and how bad it is.
> Do not change any code.
>
> 1. Nobody walks through anything: equipment, loungers, people, the
>    fence, or the water.
> 2. Nobody floats in the air or sinks into the deck.
> 3. Every entry into the water and every exit looks right, from two
>    camera angles.
> 4. The swimmers stay in their lanes and never swim through each other.
> 5. An agent that the demo turns to `working` during an errand goes to
>    the water at once.
> 6. An agent that needs the person ends at the wall with a raised hand,
>    and its label is amber.
> 7. There are never more than four creatures at once (`debug.creatures()`
>    over a simulated day via `debug.time`).
> 8. Nothing flickers: labels, styles, props, rings.
> 9. The labels never cover each other.
> 10. Night, rain and a quiet pool each look right.
> 11. The tour starts by itself after 2 minutes of no input, looks at
>     things as they happen, and stops on the first touch.
> 12. Reduced motion: emulate `prefers-reduced-motion: reduce` and check
>     that no camera moves by itself and there is no confetti, no slide
>     and no dive.
> 13. The console has 0 errors and 0 warnings.
> 14. `?demo=60&debug` holds 50 fps or more after 20 s.
> 15. `/?2d` still works and looks as it did.
> 16. Sprint 27 additions: a finished agent claps and cheers once out of
>     the water; a milestone shows confetti and its count; a session that
>     ends is cheered at the gate (confetti by day, three rockets at
>     night); `F` follows the selected agent from close and a drag lets
>     go; clicking the selected agent waves; clicking the cat makes it run;
>     clicking the flamingo or the ball bobs it.

Fix every finding that is a bug. Write each finding and what was done
about it into `docs/next.md`, as Sprints 19 and 20 did. Write down
findings left open, and why.
