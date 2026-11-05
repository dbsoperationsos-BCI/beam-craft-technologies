"""
Transcribe one audio file with faster-whisper and print the result as JSON.

By default it *translates*: a call held in Tamil, Hindi or anything else comes back as English, so
the CRM reads one language whatever was spoken. Whisper only translates into English, which is the
direction this needs. Pass --task transcribe to keep the spoken language instead.

Run as a subprocess by the transcription worker rather than as a service: a call is a few minutes
of audio a handful of times a day, and a process that starts, works and exits cannot leak a model
into the API server's memory or keep a GPU warm for nothing.

    python3 whisper.py --audio /path/to/call.wav [--model small] [--language auto]

Everything it says about progress goes to stderr; stdout carries only the JSON, so the caller can
parse it without stripping log lines.
"""

import argparse
import json
import sys


def main() -> int:
    parser = argparse.ArgumentParser(description="Transcribe an audio file with faster-whisper.")
    parser.add_argument("--audio", required=True)
    # `small` is the balance point on a CPU-only VPS: noticeably better than `base` on accented
    # speech, and still a few times faster than real time. `medium` is better again and roughly
    # three times slower, which is why it is a setting rather than the default.
    parser.add_argument("--model", default="small")
    # "auto" lets Whisper decide per file. For Tamil-English code-switching that is usually right,
    # and forcing a language makes the other one worse rather than better.
    parser.add_argument("--language", default="auto")
    # "translate" is Whisper's own cross-lingual mode: whatever is spoken comes back as English.
    # It only ever translates *into* English, which is exactly what the CRM wants - one language
    # to read, whichever language the call was held in. "transcribe" keeps the spoken language.
    parser.add_argument("--task", default="translate", choices=["translate", "transcribe"])
    parser.add_argument("--compute-type", default="int8")
    parser.add_argument("--beam-size", type=int, default=5)
    args = parser.parse_args()

    try:
        from faster_whisper import WhisperModel
    except Exception as error:  # noqa: BLE001 - the reason matters more than the class
        # Not only ImportError. faster-whisper pulls in ctranslate2, which fails to load on a machine
        # missing its native libraries - an OSError, not an ImportError - and reporting that as "not
        # installed" sends somebody to reinstall a package that is already there.
        missing = isinstance(error, ImportError)
        print(json.dumps({
            "error": "FASTER_WHISPER_MISSING" if missing else "FASTER_WHISPER_BROKEN",
            # The interpreter is named because the usual cause is the wrong one being used: the
            # package is installed for the python somebody typed, and the server is running another.
            "message": (
                f"faster-whisper is not installed for {sys.executable}. "
                f"Install it with: {sys.executable} -m pip install faster-whisper"
                if missing else
                f"faster-whisper could not be loaded by {sys.executable}: {error}"
            ),
            "python": sys.executable,
        }))
        return 0

    try:
        # int8 on CPU: the quality difference against float32 is slight for speech, and it is what
        # makes a model this size usable on a server with no GPU.
        model = WhisperModel(args.model, device="cpu", compute_type=args.compute_type)
        segments, info = model.transcribe(
            args.audio,
            task=args.task,
            beam_size=args.beam_size,
            language=None if args.language == "auto" else args.language,
            # Skips silence rather than inventing words in it, which is where Whisper tends to
            # hallucinate a stray "thank you" on a quiet line.
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 500},
        )

        out = []
        for segment in segments:
            text = (segment.text or "").strip()
            if not text:
                continue
            out.append({
                "startMs": int(segment.start * 1000),
                "endMs": int(segment.end * 1000),
                "text": text,
            })

        print(json.dumps({
            # The language Whisper heard, not the language of the text below. With task=translate
            # the text is English while this still says "ta" - which is what lets the CRM say
            # "translated from Tamil" rather than pretending the call was in English.
            "language": info.language,
            "task": args.task,
            "languageProbability": round(float(info.language_probability or 0), 4),
            "durationSeconds": int(info.duration or 0),
            "segments": out,
        }))
        return 0
    except Exception as error:  # noqa: BLE001 - the caller needs the reason, whatever it was.
        print(json.dumps({"error": "TRANSCRIBE_FAILED", "message": str(error)}))
        return 0


if __name__ == "__main__":
    sys.exit(main())
