# Jarvis spoken prompts

Wake word is **Hey Jarvis** unless you changed `name` in `soul.md` or `config.skills.jarvis`.

## Everyday questions

- Hey Jarvis, what time is it?
- Hey Jarvis, what is the capital of Arizona?
- Hey Jarvis, tell me a short joke.
- What day is it? *(within 60 seconds of the last reply, no wake word)*

## Robot vision and skills

- Hey Jarvis, what do you see?
- Hey Jarvis, scan your surroundings for a cup.
- Hey Jarvis, follow me.
- Hey Jarvis, stop following.

Requires the OpenClaw backend (default) so built-in tools and installed skills run. Follow Me needs `@agenticros/followme`.

## Presence

Walk into view of the RealSense camera. Jarvis should greet you (time of day, or “there you are” if you left and came back). Sometimes it adds “Need anything?”

## Sleep / wake

- Go to sleep.
- That’s all.
- Hey Jarvis *(unmutes if sleeping)*
- Wake up.

## Chat tools (debug)

- “Start Jarvis listening” → `jarvis_control` action `start`
- “Stop Jarvis” → `jarvis_control` action `stop`
- “Say hello out loud” → `jarvis_speak`
