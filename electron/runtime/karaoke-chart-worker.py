#!/usr/bin/env python3
"""Create an unverified UltraStar draft from isolated vocals and timed lyrics.

The Electron main process owns all paths, model availability, process
lifecycle, and user confirmation. This worker has no network behavior.
"""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import statistics
import sys
import tempfile
import wave
from dataclasses import dataclass
from typing import Any, Sequence


SCHEMA_VERSION = 1
GENERATOR_VERSION = "zenix-karaoke-chart-v1"
PITCH_MODEL = "torchcrepe-0.0.23-full-v1"
ALIGNER_MODEL = "timed-lyrics-v1"
CREPE_STEP_MS = 10
PITCH_SAMPLE_RATE = 16000
TORCHCREPE_VERSION = "0.0.23"
TORCHCREPE_MODEL_SIZE = 88_991_291
TORCHCREPE_MODEL_SHA256 = "133225604dedd2e4005f8bbd1bd0a2ec073ba8b7a6cd31ff6d5edbbfa3539986"
MAX_DURATION_MS = 15 * 60 * 1000
MAX_INPUT_BYTES = 200 * 1024 * 1024
MAX_OUTPUT_BYTES = 2 * 1024 * 1024
MAX_CONFIG_BYTES = 4 * 1024 * 1024
MAX_LYRIC_LINES = 4000
MIN_NOTE_MS = 60
MIN_LINE_NOTE_MS = 50
MAX_NOTE_GAP_MS = 25
PITCH_CONFIDENCE = 0.50
PITCH_ENERGY = 0.006
MIN_MIDI = 36
MAX_MIDI = 100
MAX_PITCH_JUMP_SEMITONES = 0.9


class WorkerError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class LyricLine:
    index: int
    start_ms: float
    end_ms: float
    text: str


@dataclass(frozen=True)
class PitchFrame:
    at_ms: float
    midi: float
    confidence: float
    energy: float


@dataclass(frozen=True)
class PitchSegment:
    start_ms: float
    end_ms: float
    midi: float
    confidence: float


@dataclass(frozen=True)
class DraftNote:
    start_ms: float
    end_ms: float
    midi: int
    confidence: float
    line_index: int
    text: str


@dataclass(frozen=True)
class ChartConfig:
    schema_version: int
    title: str
    artist: str
    duration_ms: int
    lyrics: tuple[LyricLine, ...]
    lyrics_sha256: str
    pitch_model: str
    aligner_model: str
    generator_version: str
    bpm_mode: str
    fixed_bpm: float
    min_confidence: float
    min_energy: float
    min_note_ms: int


@dataclass(frozen=True)
class ChartDraft:
    text: str
    warnings: tuple[str, ...]
    note_count: int
    line_count: int
    bpm: float
    bpm_fallback: bool


def _finite_number(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise WorkerError("CONFIG", f"{label} must be a finite number")
    number = float(value)
    if not math.isfinite(number):
        raise WorkerError("CONFIG", f"{label} must be a finite number")
    return number


def _clean_text(value: Any, label: str, maximum: int) -> str:
    if not isinstance(value, str):
        raise WorkerError("CONFIG", f"{label} must be a string")
    text = value.replace("\r", " ").replace("\n", " ").replace("_", " ")
    text = " ".join(text.split())
    if not text or len(text) > maximum or any(ord(char) < 32 for char in text):
        raise WorkerError("CONFIG", f"{label} is empty, too long, or contains control characters")
    return text


def _metadata_text(value: str) -> str:
    return " ".join(value.replace("\r", " ").replace("\n", " ").split())


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def parse_config(raw: str) -> ChartConfig:
    if not isinstance(raw, str) or not raw:
        raise WorkerError("CONFIG", "config JSON is missing")
    encoded = raw.encode("utf-8")
    if len(encoded) > MAX_CONFIG_BYTES:
        raise WorkerError("CONFIG", "config JSON exceeds 4 MiB")
    try:
        value = json.loads(raw)
    except (TypeError, ValueError) as error:
        raise WorkerError("CONFIG", f"config JSON is invalid: {error}") from error
    if not isinstance(value, dict):
        raise WorkerError("CONFIG", "config JSON must be an object")
    if value.get("schema") != SCHEMA_VERSION and value.get("schemaVersion") != SCHEMA_VERSION:
        raise WorkerError("CONFIG", "unsupported config schema")

    title = _clean_text(value.get("title"), "title", 300)
    artist = _clean_text(value.get("artist"), "artist", 300)
    duration_ms = _finite_number(value.get("durationMs"), "durationMs")
    if duration_ms <= 0 or duration_ms > MAX_DURATION_MS:
        raise WorkerError("INPUT", "durationMs must be within 15 minutes")

    pitch_model = value.get("pitchModel")
    aligner_model = value.get("alignerModel")
    generator_version = value.get("generatorVersion")
    if pitch_model != PITCH_MODEL:
        raise WorkerError("MODEL", f"unsupported pitchModel; expected {PITCH_MODEL}")
    if aligner_model != ALIGNER_MODEL:
        raise WorkerError("MODEL", f"unsupported alignerModel; expected {ALIGNER_MODEL}")
    if generator_version != GENERATOR_VERSION:
        raise WorkerError("MODEL", f"unsupported generatorVersion; expected {GENERATOR_VERSION}")

    bpm_mode = value.get("bpmMode")
    if bpm_mode not in ("auto", "fixed"):
        raise WorkerError("CONFIG", "bpmMode must be auto or fixed")
    fixed_bpm_value = value.get("fixedBpm")
    if fixed_bpm_value is None and bpm_mode == "auto":
        fixed_bpm_value = value.get("bpmFallback")
        if fixed_bpm_value is None:
            fixed_bpm_value = 120
    fixed_bpm = _finite_number(fixed_bpm_value, "fixedBpm")
    if fixed_bpm < 40 or fixed_bpm > 240:
        raise WorkerError("CONFIG", "fixedBpm must be between 40 and 240")
    min_confidence = _finite_number(value.get("minConfidence", PITCH_CONFIDENCE), "minConfidence")
    if min_confidence < 0 or min_confidence > 1:
        raise WorkerError("CONFIG", "minConfidence must be between 0 and 1")
    min_energy = _finite_number(value.get("minEnergy", PITCH_ENERGY), "minEnergy")
    if min_energy < 0 or min_energy > 1:
        raise WorkerError("CONFIG", "minEnergy must be between 0 and 1")
    min_note_ms = _finite_number(value.get("minNoteMs", MIN_NOTE_MS), "minNoteMs")
    if min_note_ms < 20 or min_note_ms > 5000:
        raise WorkerError("CONFIG", "minNoteMs must be between 20 and 5000")

    raw_lines = value.get("lyrics")
    if not isinstance(raw_lines, list):
        raise WorkerError("LYRICS", "lyrics must be an array")
    if len(raw_lines) > MAX_LYRIC_LINES:
        raise WorkerError("LYRICS", f"lyrics exceed {MAX_LYRIC_LINES} lines")
    lines: list[LyricLine] = []
    for index, row in enumerate(raw_lines):
        if not isinstance(row, dict):
            raise WorkerError("LYRICS", f"lyric line {index + 1} must be an object")
        start_ms = _finite_number(row.get("startMs"), f"lyrics[{index}].startMs")
        end_ms = _finite_number(row.get("endMs"), f"lyrics[{index}].endMs")
        text = _clean_text(row.get("text"), f"lyrics[{index}].text", 2000)
        if end_ms <= start_ms:
            raise WorkerError("LYRICS", f"lyric line {index + 1} has a non-positive duration")
        lines.append(LyricLine(index, start_ms, end_ms, text))

    normalized = normalize_lyrics(lines, duration_ms)
    if not normalized:
        raise WorkerError("LYRICS", "no timed lyric lines fall within the recording")

    canonical = json.dumps(
        [{"startMs": line.start_ms, "endMs": line.end_ms, "text": line.text} for line in normalized],
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return ChartConfig(
        schema_version=SCHEMA_VERSION,
        title=title,
        artist=artist,
        duration_ms=int(round(duration_ms)),
        lyrics=tuple(normalized),
        lyrics_sha256=hashlib.sha256(canonical).hexdigest(),
        pitch_model=pitch_model,
        aligner_model=aligner_model,
        generator_version=generator_version,
        bpm_mode=bpm_mode,
        fixed_bpm=fixed_bpm,
        min_confidence=min_confidence,
        min_energy=min_energy,
        min_note_ms=int(round(min_note_ms)),
    )


def normalize_lyrics(lines: Sequence[LyricLine], duration_ms: float) -> list[LyricLine]:
    """Sort, clamp, and make lyric intervals non-overlapping."""
    limit = float(duration_ms)
    prepared: list[tuple[float, float, str]] = []
    for row in lines:
        start = max(0.0, min(limit - 1.0, float(row.start_ms)))
        end = max(start + 1.0, min(limit, float(row.end_ms)))
        if end > start:
            prepared.append((start, end, row.text))
    prepared.sort(key=lambda item: (item[0], item[1], item[2]))

    normalized: list[LyricLine] = []
    previous_end = 0.0
    for start, end, text in prepared:
        start = max(start, previous_end)
        if start >= limit:
            continue
        end = min(end, limit)
        if end <= start:
            continue
        normalized.append(LyricLine(len(normalized), start, end, text))
        previous_end = end
    return normalized


def frame_rms(audio: Any, sample_rate: int, step_ms: int) -> list[float]:
    import numpy as np

    hop = max(1, int(round(sample_rate * step_ms / 1000)))
    if audio.size == 0:
        return []
    energies: list[float] = []
    for start in range(0, audio.size, hop):
        end = min(audio.size, start + hop)
        energy = math.sqrt(float(np.mean(np.square(audio[start:end], dtype=np.float32))))
        energies.append(min(1.0, energy))
    return energies


def analyze_pitch(input_path: Path, config: ChartConfig) -> tuple[Any, int, list[PitchFrame]]:
    try:
        import numpy as np
    except ImportError as error:
        raise WorkerError("DEPENDENCY", "NumPy is required for local chart generation") from error
    try:
        import scipy.signal
        import torch
        import torchcrepe
    except ImportError as error:
        raise WorkerError(
            "DEPENDENCY",
            "PyTorch, SciPy and torchcrepe are required for local chart generation",
        ) from error
    try:
        installed = importlib.metadata.version("torchcrepe")
    except importlib.metadata.PackageNotFoundError as error:
        raise WorkerError("DEPENDENCY", "torchcrepe package metadata is unavailable") from error
    if installed != TORCHCREPE_VERSION:
        raise WorkerError(
            "MODEL",
            f"unsupported torchcrepe version; expected {TORCHCREPE_VERSION}",
        )
    module_file = getattr(torchcrepe, "__file__", "")
    model_path = Path(module_file).resolve().parent / "assets" / "full.pth" if module_file else Path()
    try:
        model_size = model_path.stat().st_size
        model_hash = _sha256_file(model_path)
    except OSError as error:
        raise WorkerError("MODEL", "torchcrepe full model asset is unavailable") from error
    if model_size != TORCHCREPE_MODEL_SIZE or model_hash != TORCHCREPE_MODEL_SHA256:
        raise WorkerError("MODEL", "torchcrepe full model asset failed its SHA-256 check")

    if not input_path.is_absolute() or str(input_path).startswith(("\\\\", "//")):
        raise WorkerError("INPUT", "input path must be an absolute local file")
    if input_path.suffix.lower() != ".wav":
        raise WorkerError("INPUT", "input must be a WAV file")
    stat = input_path.stat()
    if not input_path.is_file() or stat.st_size <= 44 or stat.st_size > MAX_INPUT_BYTES:
        raise WorkerError("INPUT", "input WAV is missing or outside the size limit")

    try:
        with wave.open(str(input_path), "rb") as source:
            channels = source.getnchannels()
            sample_width = source.getsampwidth()
            sample_rate = source.getframerate()
            frame_count = source.getnframes()
            if channels != 2 or sample_width != 2 or sample_rate != 44100:
                raise WorkerError("INPUT", "input must be 2-channel 44100 Hz 16-bit PCM WAV")
            duration_ms = frame_count * 1000 / sample_rate
            if duration_ms <= 0 or duration_ms > MAX_DURATION_MS:
                raise WorkerError("INPUT", "input duration must be within 15 minutes")
            pcm = source.readframes(frame_count)
    except WorkerError:
        raise
    except (EOFError, OSError, wave.Error) as error:
        raise WorkerError("INPUT", f"invalid WAV input: {error}") from error

    samples = np.frombuffer(pcm, dtype="<i2")
    if samples.size != frame_count * channels:
        raise WorkerError("INPUT", "input WAV contains an incomplete sample frame")
    stereo = samples.reshape((-1, channels))
    audio = stereo[:, 0].astype(np.float32)
    audio += stereo[:, 1]
    audio *= 0.5 / 32768.0

    pitch_audio = scipy.signal.resample_poly(
        audio,
        PITCH_SAMPLE_RATE,
        sample_rate,
    ).astype(np.float32)
    pitch_tensor = torch.from_numpy(pitch_audio).unsqueeze(0)
    with contextlib.redirect_stdout(sys.stderr):
        frequency, confidence = torchcrepe.predict(
            pitch_tensor,
            PITCH_SAMPLE_RATE,
            hop_length=int(PITCH_SAMPLE_RATE * CREPE_STEP_MS / 1000),
            fmin=65.0,
            fmax=1100.0,
            model="full",
            batch_size=1024,
            device="cpu",
            return_periodicity=True,
        )
    frequencies = np.asarray(frequency.squeeze(0).cpu(), dtype=np.float64)
    confidences = np.asarray(confidence.squeeze(0).cpu(), dtype=np.float64)
    energies = frame_rms(audio, sample_rate, CREPE_STEP_MS)
    count = min(frequencies.size, confidences.size, len(energies))
    if count == 0:
        raise WorkerError("PITCH", "CREPE produced no pitch frames")

    frames: list[PitchFrame] = []
    for index in range(count):
        hz = float(frequencies[index])
        confidence_value = float(confidences[index])
        energy = float(energies[index])
        at_ms = index * CREPE_STEP_MS
        if not math.isfinite(hz) or hz < 65 or hz > 1100:
            continue
        if not math.isfinite(confidence_value) or confidence_value < config.min_confidence:
            continue
        if not math.isfinite(energy) or energy < config.min_energy:
            continue
        midi = 69 + 12 * math.log2(hz / 440.0)
        if midi < MIN_MIDI or midi > MAX_MIDI:
            continue
        frames.append(PitchFrame(at_ms, midi, min(1.0, confidence_value), energy))
    return audio, sample_rate, frames


def merge_pitch_frames(
    frames: Sequence[PitchFrame],
    min_confidence: float = PITCH_CONFIDENCE,
    min_energy: float = PITCH_ENERGY,
) -> list[PitchFrame]:
    """Suppress isolated octave jumps and short unstable runs."""
    ordered = sorted(
        (
            frame
            for frame in frames
            if math.isfinite(frame.at_ms)
            and math.isfinite(frame.midi)
            and math.isfinite(frame.confidence)
            and math.isfinite(frame.energy)
            and frame.confidence >= min_confidence
            and frame.energy >= min_energy
            and MIN_MIDI <= frame.midi <= MAX_MIDI
        ),
        key=lambda frame: frame.at_ms,
    )
    if not ordered:
        return []
    smoothed: list[PitchFrame] = []
    for index, frame in enumerate(ordered):
        previous = ordered[index - 1] if index else None
        following = ordered[index + 1] if index + 1 < len(ordered) else None
        neighborhood = [row.midi for row in (previous, frame, following) if row is not None]
        middle = statistics.median(neighborhood)
        if abs(frame.midi - middle) > MAX_PITCH_JUMP_SEMITONES:
            continue
        smoothed.append(PitchFrame(frame.at_ms, middle, frame.confidence, frame.energy))
    return smoothed


def frames_to_notes(
    frames: Sequence[PitchFrame],
    min_confidence: float = PITCH_CONFIDENCE,
    min_energy: float = PITCH_ENERGY,
    min_note_ms: int = MIN_NOTE_MS,
) -> list[PitchSegment]:
    """Merge stable contiguous pitch frames into note intervals."""
    stable = merge_pitch_frames(frames, min_confidence, min_energy)
    notes: list[PitchSegment] = []
    current: list[PitchFrame] = []

    def close() -> None:
        nonlocal current
        if not current:
            return
        start = current[0].at_ms
        end = current[-1].at_ms + CREPE_STEP_MS
        if end - start >= min_note_ms:
            midpoint = statistics.median(frame.midi for frame in current)
            confidence = statistics.fmean(frame.confidence for frame in current)
            notes.append(PitchSegment(start, end, midpoint, confidence))
        current = []

    for frame in stable:
        if not current:
            current = [frame]
            continue
        achieved_midi = statistics.median(row.midi for row in current[-8:])
        gap = frame.at_ms - current[-1].at_ms
        if gap <= MAX_NOTE_GAP_MS and abs(frame.midi - achieved_midi) <= MAX_PITCH_JUMP_SEMITONES:
            current.append(frame)
        else:
            close()
            current = [frame]
    close()
    return notes


def _map_segment_to_lines(
    line: LyricLine,
    segments: Sequence[tuple[float, float, int, float]],
    duration_ms: float,
    min_note_ms: int,
) -> list[DraftNote]:
    notes: list[DraftNote] = []
    for start, end, midi, confidence in segments:
        clipped_start = max(line.start_ms, start, 0.0)
        clipped_end = min(line.end_ms, end, duration_ms)
        if clipped_end - clipped_start < min(min_note_ms, MIN_LINE_NOTE_MS):
            continue
        notes.append(
            DraftNote(
                clipped_start,
                clipped_end,
                max(0, min(127, int(midi))),
                confidence,
                line.index,
                line.text if not notes else "",
            )
        )
    return notes


def notes_from_segments(
    lines: Sequence[LyricLine],
    segments: Sequence[tuple[float, float, int, float]],
    duration_ms: float,
    min_note_ms: int = MIN_NOTE_MS,
) -> list[DraftNote]:
    mapped: list[DraftNote] = []
    for line in lines:
        mapped.extend(_map_segment_to_lines(line, segments, duration_ms, min_note_ms))
    mapped.sort(key=lambda note: (note.start_ms, note.end_ms, note.midi))
    # Ensure a lyric rendered in one line cannot be attached to two lines when
    # two overlapping lyric rows survive upstream normalization.
    seen_line: set[int] = set()
    result: list[DraftNote] = []
    for note in mapped:
        text = note.text
        if note.line_index in seen_line:
            text = ""
        elif text:
            seen_line.add(note.line_index)
        result.append(DraftNote(note.start_ms, note.end_ms, note.midi, note.confidence, note.line_index, text))
    return result


def pitch_notes_to_segments(pitch_notes: Sequence[Any]) -> list[tuple[float, float, int, float]]:
    segments: list[tuple[float, float, int, float]] = []
    for note in pitch_notes:
        start = float(note.start_ms)
        end = float(note.end_ms)
        midi = int(round(float(note.midi)))
        confidence = float(note.confidence)
        if end <= start or not MIN_MIDI <= midi <= MAX_MIDI:
            continue
        segments.append((start, end, midi, confidence))
    return segments


def estimate_bpm(audio: Any, sample_rate: int, config: ChartConfig) -> tuple[float, bool]:
    if config.bpm_mode == "fixed":
        return float(config.fixed_bpm), False
    try:
        import numpy as np
        import librosa

        with contextlib.redirect_stdout(sys.stderr):
            tempo, _ = librosa.beat.beat_track(y=np.asarray(audio), sr=sample_rate, units="time")
        value = float(np.asarray(tempo).reshape(-1)[0])
        if math.isfinite(value) and 40 <= value <= 240:
            return round(value, 3), False
    except Exception:
        pass
    return float(config.fixed_bpm), True


def _beat_positions(
    note: DraftNote,
    tick_ms: float,
    duration_ms: float,
) -> tuple[int, int] | None:
    if tick_ms <= 0:
        return None
    start_beat = max(0, int(round(note.start_ms / tick_ms)))
    duration_beats = max(1, int(round((note.end_ms - note.start_ms) / tick_ms)))
    if start_beat * tick_ms >= duration_ms:
        return None
    return start_beat, duration_beats


def build_ultrastar(
    config: ChartConfig,
    lines: Sequence[LyricLine],
    draft_notes: Sequence[DraftNote],
    bpm: float,
    bpm_fallback: bool,
) -> ChartDraft:
    if not draft_notes:
        raise WorkerError("PITCH", "no usable pitch notes were found")
    if not math.isfinite(bpm) or bpm < 40 or bpm > 240:
        raise WorkerError("PITCH", "BPM is outside the supported range")
    tick_ms = 60_000.0 / (bpm * 4.0)
    grouped: dict[int, list[DraftNote]] = {}
    for note in draft_notes:
        grouped.setdefault(note.line_index, []).append(note)

    warnings: list[str] = []
    if bpm_fallback:
        warnings.append(f"bpm_fallback_fixed_{bpm:g}")
    warnings.append(f"timing_quantized_to_{tick_ms:.3f}ms")
    empty_lines = sum(1 for line in lines if line.index not in grouped)
    if empty_lines:
        warnings.append(f"{empty_lines}_lyric_lines_without_notes")
    if bpm_fallback:
        warnings.append("bpm_estimated_unavailable")

    rows = [
        "#VERSION:1.0.0",
        f"#TITLE:{_metadata_text(config.title)}",
        f"#ARTIST:{_metadata_text(config.artist)}",
        f"#BPM:{bpm:.3f}".rstrip("0").rstrip("."),
        "#GAP:0",
        "#ZENIX-GENERATED:yes",
        f"#ZENIX-GENERATOR:{GENERATOR_VERSION}",
        f"#ZENIX-PITCH-MODEL:{PITCH_MODEL}",
        f"#ZENIX-ALIGNER:{ALIGNER_MODEL}",
        f"#ZENIX-LYRICS-SHA256:{config.lyrics_sha256}",
        f"#ZENIX-BPM-FALLBACK:{'yes' if bpm_fallback else 'no'}",
        f"#ZENIX-WARNINGS:{'|'.join(warnings)}",
    ]
    written_lines = 0
    written_notes = 0
    previous_end = 0
    for line in lines:
        notes = sorted(grouped.get(line.index, ()), key=lambda item: (item.start_ms, item.end_ms))
        line_rows: list[str] = []
        for note in notes:
            positions = _beat_positions(note, tick_ms, config.duration_ms)
            if not positions:
                continue
            start_beat, duration_beats = positions
            start_beat = max(start_beat, previous_end)
            if start_beat * tick_ms >= config.duration_ms:
                continue
            lyric = _metadata_text(note.text).replace("_", " ")
            line_rows.append(
                f": {start_beat} {duration_beats} {note.midi - 60} {lyric}".rstrip()
            )
            previous_end = start_beat + duration_beats
            written_notes += 1
        if line_rows:
            rows.extend(line_rows)
            rows.append("-")
            written_lines += 1
    rows.append("E")
    text = "\n".join(rows) + "\n"
    if written_notes == 0 or written_lines == 0:
        raise WorkerError("PITCH", "all pitch notes fell outside the lyric timeline")
    byte_count = len(text.encode("utf-8"))
    if byte_count > MAX_OUTPUT_BYTES:
        raise WorkerError("OUTPUT", "generated chart exceeds 2 MiB")
    return ChartDraft(text, tuple(warnings), written_notes, written_lines, float(bpm), bpm_fallback)


def _write_atomic(path: Path, data: str) -> None:
    if not path.is_absolute() or str(path).startswith(("\\\\", "//")):
        raise WorkerError("OUTPUT", "output path must be an absolute local file")
    if path.suffix.lower() != ".txt":
        raise WorkerError("OUTPUT", "output must use the .txt extension")
    if not path.parent.is_dir():
        raise WorkerError("OUTPUT", "output directory does not exist")
    payload = data.encode("utf-8")
    if len(payload) > MAX_OUTPUT_BYTES:
        raise WorkerError("OUTPUT", "generated chart exceeds 2 MiB")
    descriptor = -1
    temporary = ""
    try:
        descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
        with os.fdopen(descriptor, "wb") as target:
            descriptor = -1
            target.write(payload)
            target.flush()
            os.fsync(target.fileno())
        os.replace(temporary, path)
        temporary = ""
    except OSError as error:
        raise WorkerError("OUTPUT", f"cannot write generated chart: {error}") from error
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        if temporary:
            with contextlib.suppress(OSError):
                os.unlink(temporary)


def generate_chart(input_path: Path, output_path: Path, config: ChartConfig) -> dict[str, Any]:
    if input_path.resolve() == output_path.resolve():
        raise WorkerError("OUTPUT", "input and output must be different files")
    audio, sample_rate, frames = analyze_pitch(input_path, config)
    _emit_progress("aligning")
    measured_ms = int(round(audio.size * 1000 / sample_rate))
    tolerance = max(500.0, config.duration_ms * 0.002)
    if abs(measured_ms - config.duration_ms) > tolerance:
        raise WorkerError("INPUT", "vocals duration does not match the configured recording")
    merged = frames_to_notes(
        frames,
        min_confidence=config.min_confidence,
        min_energy=config.min_energy,
        min_note_ms=config.min_note_ms,
    )
    segments = pitch_notes_to_segments(merged)
    mapped = notes_from_segments(config.lyrics, segments, config.duration_ms, config.min_note_ms)
    bpm, fallback = estimate_bpm(audio, sample_rate, config)
    draft = build_ultrastar(config, config.lyrics, mapped, bpm, fallback)
    _write_atomic(output_path, draft.text)
    return {
        "status": "ready",
        "warnings": list(draft.warnings),
        "noteCount": draft.note_count,
        "lineCount": draft.line_count,
        "bpm": draft.bpm,
        "bpmFallback": draft.bpm_fallback,
        "models": {
            "pitch": config.pitch_model,
            "aligner": config.aligner_model,
            "generator": config.generator_version,
        },
    }


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--config-json")
    source.add_argument("--config-file")
    return parser


def _emit(payload: dict[str, Any]) -> None:
    encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    sys.stdout.buffer.write(encoded + b"\n")
    sys.stdout.buffer.flush()


def _emit_progress(stage: str) -> None:
    encoded = json.dumps(
        {"status": "progress", "stage": stage},
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    sys.stderr.buffer.write(encoded + b"\n")
    sys.stderr.buffer.flush()


def _emit_error(code: str, message: str) -> None:
    encoded = json.dumps(
        {"status": "error", "code": code, "message": message},
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    sys.stderr.buffer.write(encoded + b"\n")
    sys.stderr.buffer.flush()


def main(argv: Sequence[str] | None = None) -> int:
    try:
        args = _parser().parse_args(argv)
        if args.config_file:
            config_path = Path(args.config_file)
            try:
                stat = config_path.stat()
                if not config_path.is_absolute() or not config_path.is_file() or stat.st_size > MAX_CONFIG_BYTES:
                    raise WorkerError("CONFIG", "config file is missing, invalid, or exceeds 4 MiB")
                raw_config = config_path.read_text(encoding="utf-8")
            except WorkerError:
                raise
            except (OSError, UnicodeError) as error:
                raise WorkerError("CONFIG", f"cannot read config file: {error}") from error
        else:
            raw_config = args.config_json
        config = parse_config(raw_config)
        result = generate_chart(Path(args.input), Path(args.output), config)
        _emit(result)
        return 0
    except WorkerError as error:
        _emit_error(error.code, error.message)
        return 2
    except (OSError, ValueError) as error:
        message = f"chart generation failed: {error}"
        _emit_error("INTERNAL", message)
        return 2
    except Exception as error:
        message = f"chart generation failed: {error}"
        _emit_error("INTERNAL", message)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
