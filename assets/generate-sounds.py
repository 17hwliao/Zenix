"""Generate Zenix's original, short interface sounds with the Python standard library."""

from math import exp, pi, sin
from pathlib import Path
from struct import pack
import wave

RATE = 32000
DEST = Path(__file__).parent / "sounds"
DEST.mkdir(exist_ok=True)


def samples(kind: str, variant: int):
    duration = (0.18 + variant * 0.012) if kind == "enter" else (0.17 + variant * 0.009) if kind == "cancel" else (0.25 + variant * 0.012)
    count = int(RATE * duration)
    phase = 0.0
    noise_state = 32171 + variant * 7919
    smoothed_noise = 0.0
    output = []
    for index in range(count):
        t = index / RATE
        u = index / count
        noise_state = (1664525 * noise_state + 1013904223) & 0xFFFFFFFF
        noise = (noise_state / 0x7FFFFFFF) - 1
        smoothed_noise = smoothed_noise * 0.81 + noise * 0.19
        if kind == "enter":
            frequency = (540 + variant * 78) * (1.18 - 0.28 * u)
            phase += 2 * pi * frequency / RATE
            click = (1 - u) ** 9 * smoothed_noise * (0.15 + variant * 0.012)
            tone = sin(phase) + (0.25 + variant * 0.035) * sin(phase * 2) + 0.12 * sin(phase * 3)
            envelope = min(1, t / 0.003) * exp(-u * (4.5 - variant * 0.22))
            value = 0.33 * envelope * tone + click
        elif kind == "cancel":
            frequency = (475 + variant * 48) * (1 - 0.55 * u)
            phase += 2 * pi * frequency / RATE
            tone = sin(phase) + 0.18 * sin(phase * 1.5)
            envelope = min(1, t / 0.004) * exp(-u * (5.1 - variant * 0.13))
            value = 0.35 * envelope * tone + (1 - u) ** 10 * smoothed_noise * 0.08
        else:
            frequency = (140 + variant * 21) + (210 + variant * 31) * u
            phase += 2 * pi * frequency / RATE
            envelope = (sin(pi * u) ** 1.7) * exp(-u * 0.8)
            value = envelope * ((0.20 + variant * 0.015) * smoothed_noise + 0.16 * sin(phase))
        output.append(max(-0.72, min(0.72, value)))
    return output


for sound_kind in ("enter", "cancel", "slide"):
    for number in range(1, 6):
        path = DEST / f"{sound_kind}-{number}.wav"
        with wave.open(str(path), "wb") as file:
            values = samples(sound_kind, number)
            file.setnchannels(1)
            file.setsampwidth(2)
            file.setframerate(RATE)
            file.writeframes(b"".join(pack("<h", int(value * 32767)) for value in values))
        print(path.name)
